import { By, until, WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { attachDriver, releaseDriver } from './chromeProfile';
import { saveJobIfNew } from './scrapeUtils';

/** Summer 2027 Software — direct search API URL (one load, no refresh loop) */
function primaryJobrightUrl(kind: 'internship' | 'fulltime' = 'internship'): string {
  if (kind === 'fulltime') {
    return config.jobright.fullTimeSearchUrl || config.jobright.fullTimeSearches[0];
  }
  return config.jobright.searchUrl || config.jobright.searches[0];
}

function orangeProfile(kind: 'internship' | 'fulltime' = 'internship') {
  const { linkedin } = config;
  const startUrl = primaryJobrightUrl(kind);
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl,
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

async function scrollJobrightListOnce(driver: WebDriver): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await driver.executeScript('window.scrollBy(0, window.innerHeight);');
    await driver.sleep(800);
  }
  await driver.executeScript('window.scrollTo(0, 0);');
}

async function extractJobrightCards(driver: WebDriver, maxCards: number): Promise<JobrightCard[]> {
  await scrollJobrightListOnce(driver);

  const cards = await driver.executeScript(
    `
    const maxCards = arguments[0];
    const out = [];
    const seen = new Set();

    function pushCard(title, href, blockText) {
      if (!title || !href || seen.has(href)) return;
      if (!/intern|2027|summer|engineer|developer|software/i.test(title)) return;
      const lines = (blockText || '').split('\\n').map(l => l.trim()).filter(Boolean);
      let company = '';
      for (const line of lines) {
        if (line === title) continue;
        if (/\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i.test(line)) continue;
        if (/applicant|apply now|match score|internship|onsite|remote|hybrid/i.test(line)) continue;
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

    for (const h of document.querySelectorAll('h2')) {
      const title = (h.textContent || '').trim();
      if (!title || title.length < 8) continue;
      let a = h.closest('a[href*="/jobs/info/"]');
      if (!a) {
        let el = h.parentElement;
        for (let i = 0; i < 6 && el; i++) {
          a = el.querySelector('a[href*="/jobs/info/"]');
          if (a) break;
          el = el.parentElement;
        }
      }
      if (!a) continue;
      pushCard(title, (a.href || '').split('?')[0], (h.closest('div')?.innerText || ''));
      if (out.length >= maxCards) return out;
    }

    for (const a of document.querySelectorAll('a[href*="/jobs/info/"]')) {
      const href = (a.href || '').split('?')[0];
      if (!href || seen.has(href)) continue;
      const block = a.closest('article, li, section, div') || a.parentElement;
      const text = (block?.innerText || '').trim();
      const title = text.split('\\n').find(l => /intern|engineer|developer|software|2027|summer/i.test(l) && l.length > 8)
        || (a.textContent || '').trim();
      pushCard(title, href, text);
      if (out.length >= maxCards) return out;
    }
    return out;
  `,
    maxCards
  );

  return Array.isArray(cards) ? (cards as JobrightCard[]) : [];
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
 * Jobright: load Summer 2027 search ONCE, collect URLs, visit each job once (no reload back to list).
 */
export async function scrapeJobrightJobs(
  savedJobIds: string[],
  jobType: 'internship' | 'fulltime' = 'internship'
): Promise<string[]> {
  const target = scrapeRunTarget();
  const maxCards = config.jobright.maxJobsPerSearch;

  let driver: WebDriver | null = null;
  try {
    driver = await attachDriver(orangeProfile(jobType));
    const label = jobType === 'fulltime' ? 'full-time software' : 'Summer 2027';
    console.log(`\n🎯 Jobright — ${label} — one search page, forward-only (no refresh loop)`);
    const searchUrl = primaryJobrightUrl(jobType);
    console.log(`   ${searchUrl}`);

    await driver.get(searchUrl);
    await driver.sleep(8000);

    try {
      await driver.wait(until.elementLocated(By.css('h2, a[href*="/jobs/info/"]')), 20000);
    } catch {
      console.log('  Jobright search page did not load listings.');
      return savedJobIds;
    }

    const cards = await extractJobrightCards(driver, maxCards);
    console.log(`  Found ${cards.length} ${label} listings — opening each once`);

    for (let i = 0; i < cards.length; i++) {
      if (savedJobIds.length >= target) break;

      const card = cards[i];
      console.log(`[Jobright ${i + 1}/${cards.length}] ${card.title}`);

      try {
        await driver.get(card.href);
        await driver.sleep(3000);

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
        });

        if (id) {
          savedJobIds.push(id);
          console.log(`  ↳ Saved [${savedJobIds.length}]`);
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

  console.log(`\n✅ Jobright done — ${savedJobIds.length} saved this run.`);
  return savedJobIds;
}
