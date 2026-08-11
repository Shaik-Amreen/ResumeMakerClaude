import { By, until, WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { attachDriver, releaseDriver } from './chromeProfile';
import { isDuplicateJob } from './jobDedup';
import { isUndergraduateOnlyJob } from './jobSkipRules';
import { saveJobIfNew } from './scrapeUtils';
import { shouldAbortScrape } from './scrapeContext';
import { appendTaskLog, incrementScraped, logScrapingUrl, setTaskProgress } from './taskStatusService';

function searchUrls(kind: 'internship' | 'fulltime' = 'internship'): string[] {
  if (kind === 'fulltime') {
    const list = config.jobright.fullTimeSearches?.length
      ? config.jobright.fullTimeSearches
      : [config.jobright.fullTimeSearchUrl];
    return list.filter(Boolean);
  }
  const list = config.jobright.searches?.length
    ? config.jobright.searches
    : [config.jobright.searchUrl];
  return list.filter(Boolean);
}

function orangeProfile(kind: 'internship' | 'fulltime' = 'internship') {
  const { linkedin } = config;
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl: searchUrls(kind)[0],
  };
}

interface JobrightCard {
  title: string;
  company: string;
  href: string;
  posted?: string;
  applicants?: string;
  location?: string;
}

/** One scroll step on the virtualized results pane (or window fallback). */
async function scrollListStep(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    const links = [...document.querySelectorAll('a[href*="/jobs/info/"]')];
    if (links.length) links[links.length - 1].scrollIntoView({ block: 'end', inline: 'nearest' });

    const link = links[0] || document.querySelector('a[href*="/jobs/info/"]');
    let scrolled = false;
    let el = link ? link.parentElement : null;
    while (el) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY || '';
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 40) {
        el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(220, Math.floor(el.clientHeight * 0.85)));
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }));
        scrolled = true;
        break;
      }
      el = el.parentElement;
    }
    if (!scrolled) {
      const candidates = [...document.querySelectorAll('div, section, main, aside')].filter((n) => {
        const s = window.getComputedStyle(n);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 80;
      });
      candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
      if (candidates[0]) {
        candidates[0].scrollTop += Math.max(220, Math.floor(candidates[0].clientHeight * 0.85));
        candidates[0].dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }));
        scrolled = true;
      }
    }
    if (!scrolled) window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
  `);
  await driver.sleep(450);
  // Advance selection so virtualized rows refresh
  try {
    await driver.actions().sendKeys('\uE015').perform(); // ARROW_DOWN
  } catch {
    /* ignore if focus unavailable */
  }
  await driver.sleep(200);
}

async function readVisibleCards(driver: WebDriver): Promise<JobrightCard[]> {
  const batch = await driver.executeScript(`
    const out = [];
    const seen = new Set();

    function pushCard(title, href, blockText) {
      if (!title || !href || seen.has(href)) return;
      if (!/intern|2027|summer|engineer|developer|software|swe\\b|full.?stack|backend|frontend/i.test(title)) return;
      const lines = (blockText || '').split('\\n').map(l => l.trim()).filter(Boolean);
      let company = '';
      for (const line of lines) {
        if (line === title) continue;
        if (/\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i.test(line)) continue;
        if (/applicant|apply now|match score|internship|onsite|remote|hybrid|full.?time/i.test(line)) continue;
        if (line.length > 3 && line.length < 70) { company = line.split('/')[0].trim(); break; }
      }
      let posted = lines.find(l => /\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i.test(l)) || '';
      let applicants = lines.find(l => /applicant/i.test(l)) || '';
      let location = lines.find(l => /,\\s*[A-Z]{2}\\b/.test(l) && l.length < 90) || '';
      seen.add(href);
      out.push({
        title, company, href,
        posted: posted || undefined,
        applicants: applicants || undefined,
        location: location || undefined,
      });
    }

    for (const h of document.querySelectorAll('h2, h3')) {
      const title = (h.textContent || '').trim();
      if (!title || title.length < 8) continue;
      let a = h.closest('a[href*="/jobs/info/"]');
      if (!a) {
        let el = h.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          a = el.querySelector('a[href*="/jobs/info/"]');
          if (a) break;
          el = el.parentElement;
        }
      }
      if (!a) continue;
      pushCard(title, (a.href || '').split('?')[0], (h.closest('div')?.innerText || ''));
    }

    for (const a of document.querySelectorAll('a[href*="/jobs/info/"]')) {
      const href = (a.href || '').split('?')[0];
      if (!href || seen.has(href)) continue;
      const block = a.closest('article, li, section, div') || a.parentElement;
      const text = (block?.innerText || '').trim();
      const title = text.split('\\n').find(l => /intern|engineer|developer|software|2027|summer|swe\\b/i.test(l) && l.length > 8)
        || (a.textContent || '').trim();
      pushCard(title, href, text);
    }
    return out;
  `);

  return Array.isArray(batch) ? (batch as JobrightCard[]) : [];
}

/**
 * Jobright uses a virtualized list (~8 cards in DOM). Accumulate hrefs WHILE scrolling —
 * do not replace the set with a single snapshot.
 */
async function collectCardsByScrolling(
  driver: WebDriver,
  searchUrl: string,
  need: number
): Promise<JobrightCard[]> {
  console.log(`  Loading ${searchUrl}`);
  await driver.get(searchUrl);
  await driver.sleep(10000);

  try {
    await driver.wait(
      until.elementLocated(By.css('h2, h3, a[href*="/jobs/info/"], [class*="job"]')),
      40000
    );
  } catch {
    console.log('  ↳ Listings did not load — log into jobright.ai in Orange Chrome and retry.');
    appendTaskLog('Jobright: listings did not load (login/refresh Orange Chrome).');
    return [];
  }

  await driver.sleep(2000);

  const byHref = new Map<string, JobrightCard>();
  let stagnant = 0;
  const maxRounds = Math.max(80, need * 2);

  for (let round = 0; round < maxRounds && byHref.size < need && stagnant < 8; round++) {
    if (shouldAbortScrape()) break;

    const visible = await readVisibleCards(driver);
    const before = byHref.size;
    for (const c of visible) {
      if (c.href) byHref.set(c.href, c);
    }
    const gained = byHref.size - before;
    if (gained === 0) stagnant += 1;
    else stagnant = 0;

    if (round % 5 === 0 || gained > 0) {
      console.log(`  scroll ${round + 1}: +${gained} → ${byHref.size} unique (visible ${visible.length})`);
    }
    if (round % 10 === 0) {
      appendTaskLog(`Jobright collecting… ${byHref.size} unique listings`);
      setTaskProgress(byHref.size, need, `Jobright collecting ${byHref.size}/${need} listings`);
    }

    await scrollListStep(driver);
  }

  console.log(`  Collected ${byHref.size} unique listings from this search`);
  return [...byHref.values()];
}

async function readJobrightDetail(driver: WebDriver): Promise<{
  description: string;
  posted?: string;
  applicants?: string;
  company?: string;
  title?: string;
}> {
  return (await driver.executeScript(`
    const text = document.body.innerText || '';
    const h1 = document.querySelector('h1');
    const title = h1 ? (h1.textContent || '').trim() : '';
    let description = '';
    const main = document.querySelector('main');
    if (main) description = (main.innerText || '').trim();
    if (description.length < 200) description = text.slice(0, 12000);
    let posted = (text.match(/\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i) || [])[0] || '';
    let applicants = (text.match(/(?:Less than\\s+)?[\\d,]+\\+?\\s+applicants?/i) || [])[0] || '';
    let company = '';
    if (h1?.previousElementSibling) company = (h1.previousElementSibling.textContent || '').split('·')[0].trim();
    return { description, posted, applicants, company, title };
  `)) as {
    description: string;
    posted?: string;
    applicants?: string;
    company?: string;
    title?: string;
  };
}

/**
 * Jobright: multi-search + virtualized-list accumulation until `target` new matched jobs are saved.
 */
export async function scrapeJobrightJobs(
  savedJobIds: string[],
  jobType: 'internship' | 'fulltime' = 'internship'
): Promise<string[]> {
  const target = scrapeRunTarget();
  // Over-collect — citizenship / non-software / dupes remove many; keep bounded for small runs
  const collectNeed = Math.max(target * 5, Math.min(100, target + 35));

  let driver: WebDriver | null = null;
  try {
    driver = await attachDriver(orangeProfile(jobType));
    const label = jobType === 'fulltime' ? 'full-time software' : 'Summer 2027';
    const urls = searchUrls(jobType);
    console.log(`\n🎯 Jobright — ${label} — save up to ${target} new jobs across ${urls.length} search(es)`);
    appendTaskLog(`Jobright: targeting ${target} new jobs across ${urls.length} search(es)`);

    const queue: JobrightCard[] = [];
    const queued = new Set<string>();

    for (let s = 0; s < urls.length && savedJobIds.length < target; s++) {
      if (shouldAbortScrape()) break;
      // Keep collecting until queue is large enough to likely yield `target` saves
      if (queued.size >= collectNeed) break;

      const searchUrl = urls[s];
      console.log(`\n🔎 Search ${s + 1}/${urls.length}`);
      logScrapingUrl(searchUrl, `Jobright search ${s + 1}/${urls.length}`);

      const cards = await collectCardsByScrolling(driver, searchUrl, collectNeed);
      for (const c of cards) {
        if (!queued.has(c.href)) {
          queued.add(c.href);
          queue.push(c);
        }
      }
      console.log(`  Queue size after search ${s + 1}: ${queue.length}`);
      appendTaskLog(`Jobright queue: ${queue.length} unique listings`);
    }

    console.log(`\n  Opening up to ${queue.length} listings until ${target} new saves…`);
    appendTaskLog(`Jobright opening ${queue.length} listings (save up to ${target})`);

    for (let i = 0; i < queue.length; i++) {
      if (shouldAbortScrape()) {
        appendTaskLog('Jobright scrape stopped by user.');
        break;
      }
      if (savedJobIds.length >= target) break;

      const card = queue[i];
      console.log(`[Jobright ${i + 1}/${queue.length}] ${card.title}`);
      setTaskProgress(
        savedJobIds.length,
        target,
        `Jobright saved ${savedJobIds.length}/${target} (card ${i + 1}/${queue.length})`
      );

      const dup = await isDuplicateJob(card.href, card.title, card.company || '');
      if (dup) {
        console.log('  ↳ Duplicate — skip');
        continue;
      }

      if (isUndergraduateOnlyJob(card.title, '')) {
        console.log('  ↳ Skipped — undergraduate only');
        continue;
      }

      try {
        logScrapingUrl(card.href, `Jobright ${i + 1}/${queue.length} ${card.title}`);
        await driver.get(card.href);
        await driver.sleep(2800);

        const detail = await readJobrightDetail(driver);
        const id = await saveJobIfNew({
          title: detail.title || card.title,
          company: card.company || detail.company || 'Unknown',
          url: (await driver.getCurrentUrl()).split('?')[0],
          jobDescription: detail.description,
          location: card.location,
          posted: detail.posted || card.posted,
          applicants: detail.applicants || card.applicants,
          source: 'jobright',
          forcedType: jobType,
          pipelinePhase: 'jobright',
        });

        if (id) {
          savedJobIds.push(id);
          incrementScraped();
          console.log(`  ↳ Saved [${savedJobIds.length}/${target}]`);
          setTaskProgress(
            savedJobIds.length,
            target,
            `Jobright saved ${savedJobIds.length}/${target}`
          );
        } else {
          console.log('  ↳ Skipped (duplicate or filter)');
        }
      } catch (err) {
        console.error(`  ↳ Error:`, err);
      }
    }
  } finally {
    await releaseDriver(driver);
  }

  console.log(`\n✅ Jobright done — ${savedJobIds.length} saved this run (target ${target}).`);
  appendTaskLog(`Jobright done — ${savedJobIds.length}/${target} saved.`);
  return savedJobIds;
}
