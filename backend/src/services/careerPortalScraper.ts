import { By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { resolvePortalTarget } from '../utils/scrapeLimits';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { attachDriver, releaseDriver } from './chromeProfile';
import { saveJobIfNew, type ScrapeSource } from './scrapeUtils';
import { isDuplicateJob } from './jobDedup';
import { shouldAbortScrape, scrapeSleep } from './scrapeContext';
import { appendTaskLog, incrementScraped, logScrapingUrl, setTaskProgress } from './taskStatusService';

/**
 * "Career portals" in the pipeline = Google Jobs search (US), not company career sites.
 */

function orangeProfile() {
  const { linkedin } = config;
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl: 'https://www.google.com/',
  };
}

async function dismissGoogleNoise(driver: WebDriver) {
  const selectors = [
    'button#L2AGLb',
    'button[aria-label="Accept all"]',
    'button[aria-label="Reject all"]',
    'form[action*="consent"] button',
  ];
  for (const sel of selectors) {
    try {
      const btns = await driver.findElements(By.css(sel));
      if (btns[0]) {
        await btns[0].click();
        await scrapeSleep(800);
        break;
      }
    } catch {
      // ignore
    }
  }
}

async function getGoogleJobCards(driver: WebDriver): Promise<WebElement[]> {
  const selectors = [
    'li.iFjolb',
    'div.PwjeAc',
    'li[data-ved] div.gws-plugins-horizon-jobs__li-ed',
    'div[jscontroller][data-ved] .BjJfJf',
    'div.gws-plugins-horizon-jobs__li-ed',
    'ul.nJlQNc > li',
    'div[role="list"] > div[role="listitem"]',
    'div.g a[data-ved]',
  ];
  for (const selector of selectors) {
    try {
      const cards = await driver.findElements(By.css(selector));
      if (cards.length >= 3) return cards;
      if (cards.length) return cards;
    } catch {
      // try next
    }
  }
  return [];
}

async function readDetailFromPage(driver: WebDriver): Promise<{
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  posted: string;
}> {
  const data = await driver.executeScript(`
    const text = (document.body && document.body.innerText) || '';
    const pick = (sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        const t = (el && (el.innerText || el.textContent) || '').trim();
        if (t) return t;
      }
      return '';
    };

    let title = pick([
      'h2.KLsYx', 'h1.KLsYx', 'h2[itemprop="title"]', 'h1',
      '.jobtitle', '[data-attrid="title"] h2', '.pMhGee h2'
    ]);
    let company = pick([
      '.nJlQNc .vNEEBe', '.vNEEBe', '[class*="company"]',
      'a[data-attrid="company"]', '.WaH2Fe'
    ]);
    let location = pick([
      '.nJlQNc .Qk80Jf', '.Qk80Jf', '[class*="location"]',
      'span[data-attrid="location"]'
    ]);

    // Fallback: parse first lines of the jobs panel
    if (!title || !company) {
      const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
      if (!title && lines[0] && lines[0].length < 120) title = lines[0];
      if (!company && lines[1] && lines[1].length < 80) company = lines[1];
    }

    let description = '';
    const descEl = document.querySelector(
      '.YgLbBe, .HBgzvc, [class*="description"], [itemprop="description"], .job-description'
    );
    if (descEl) description = (descEl.innerText || '').trim();
    if (description.length < 120) {
      const m = text.match(/(?:Full job description|About the job|Job description)\\n([\\s\\S]{120,8000})/i);
      if (m) description = m[1].trim();
    }
    if (description.length < 80) description = text.slice(0, 6000);

    let posted = '';
    const postedM = text.match(/(?:Posted|Reposted)?\\s*(\\d+\\s+(?:minute|hour|day|week|month)s?\\s+ago|Just posted)/i);
    if (postedM) posted = postedM[0].trim();

    // Prefer real apply / company links over Google
    let applyUrl = '';
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    for (const a of anchors) {
      const href = a.href || '';
      const label = ((a.innerText || a.getAttribute('aria-label') || '') + '').toLowerCase();
      if (!href || href.startsWith('javascript:')) continue;
      if (/google\\.(com|co)|gstatic|accounts\\.google|support\\.google/.test(href)) continue;
      if (/apply|company site|official site|learn more|view job/i.test(label) ||
          /greenhouse|lever\\.co|myworkdayjobs|ashbyhq|jobvite|icims|taleo|boards\\.|careers\\.|jobs\\./i.test(href)) {
        applyUrl = href;
        break;
      }
    }
    if (!applyUrl) {
      for (const a of anchors) {
        const href = a.href || '';
        if (/^https?:/i.test(href) && !/google\\.(com|co)|gstatic/.test(href)) {
          applyUrl = href;
          break;
        }
      }
    }

    return { title, company, location, description: description.slice(0, 12000), applyUrl, posted };
  `);

  return (
    (data as {
      title: string;
      company: string;
      location: string;
      description: string;
      applyUrl: string;
      posted: string;
    }) || {
      title: '',
      company: '',
      location: '',
      description: '',
      applyUrl: '',
      posted: '',
    }
  );
}

/** Unwrap Google redirect URLs when possible. */
function normalizeApplyUrl(raw: string, fallbackGoogleUrl: string): string {
  if (!raw) return fallbackGoogleUrl;
  try {
    const u = new URL(raw);
    if (u.hostname.includes('google.') && u.searchParams.get('q')) {
      const q = u.searchParams.get('q') || '';
      if (/^https?:/i.test(q)) return q.split('&')[0];
    }
    if (u.hostname.includes('google.') && u.pathname.includes('/url')) {
      const dest = u.searchParams.get('q') || u.searchParams.get('url');
      if (dest && /^https?:/i.test(dest)) return dest;
    }
    return raw.split('&')[0];
  } catch {
    return raw || fallbackGoogleUrl;
  }
}

async function scrapeGoogleSearch(
  driver: WebDriver,
  searchUrl: string,
  savedIds: string[],
  target: number
): Promise<void> {
  console.log(`\n=== Google Jobs search (US) ===`);
  console.log(searchUrl);
  logScrapingUrl(searchUrl, 'Google Jobs search');

  await driver.get(searchUrl);
  await scrapeSleep(3500);
  await dismissGoogleNoise(driver);
  await scrapeSleep(1500);

  if (shouldAbortScrape()) {
    appendTaskLog('Google Jobs scrape stopped by user.');
    return;
  }

  try {
    await driver.wait(
      until.elementLocated(
        By.css('li.iFjolb, div.PwjeAc, div.gws-plugins-horizon-jobs__li-ed, div.g, [role="listitem"]')
      ),
      20000
    );
  } catch {
    console.log('No Google Jobs results for this query.');
    return;
  }

  // Scroll the jobs list a bit to load more cards
  try {
    await driver.executeScript(`
      const list = document.querySelector('div[role="list"], ul.nJlQNc, div.gws-plugins-horizon-jobs__tl-lvc') || document.body;
      for (let i = 0; i < 6; i++) {
        list.scrollTop = list.scrollHeight;
      }
    `);
    await scrapeSleep(1200);
  } catch {
    // ignore
  }

  const cards = await getGoogleJobCards(driver);
  const perSearch = config.careerPortal.maxJobsPerSearch;
  const limit = Math.min(cards.length, perSearch, Math.max(0, target - savedIds.length));
  console.log(`Google: ${cards.length} cards — processing up to ${limit}`);
  appendTaskLog(`Google Jobs: ${cards.length} cards — processing up to ${limit}`);

  for (let i = 0; i < limit; i++) {
    if (shouldAbortScrape()) {
      appendTaskLog('Google Jobs scrape stopped by user.');
      return;
    }
    if (savedIds.length >= target) return;

    try {
      const fresh = await getGoogleJobCards(driver);
      if (i >= fresh.length) break;
      const card = fresh[i];

      try {
        await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', card);
        await scrapeSleep(300);
        await card.click();
      } catch {
        try {
          await driver.executeScript('arguments[0].click();', card);
        } catch {
          console.log(`  ↳ Could not open Google card ${i + 1}`);
          appendTaskLog(`  ↳ Could not open Google card ${i + 1}`);
          continue;
        }
      }

      await scrapeSleep(1800);
      setTaskProgress(savedIds.length + 1, target, `Google Jobs ${i + 1}/${limit}`);

      const details = await readDetailFromPage(driver);
      const title = details.title?.trim();
      const company = details.company?.trim();
      const location = details.location?.trim() || 'United States';
      const description = details.description?.trim();
      const pageUrl = await driver.getCurrentUrl();
      const url = normalizeApplyUrl(details.applyUrl, pageUrl);

      console.log(`[Google ${i + 1}/${limit}] ${title || '?'} @ ${company || '?'}`);
      appendTaskLog(
        `🔗 Google ${i + 1}/${limit}: ${title || '?'} @ ${company || '?'} — ${(url || pageUrl).slice(0, 100)}`
      );

      if (!title || !company || !description) {
        console.log('  ↳ Skipped — missing title/company/description');
        continue;
      }

      if (await isDuplicateJob(url, title, company)) {
        console.log('  ↳ Duplicate — skip');
        continue;
      }

      const id = await saveJobIfNew({
        title,
        company,
        url,
        jobDescription: description,
        location,
        posted: details.posted || undefined,
        source: 'career_portal' as ScrapeSource,
        forcedType: 'internship',
        priority: isFaangMangoCompany(company) ? 'faang' : 'standard',
        pipelinePhase: 'career_portal',
      });

      if (!id) {
        console.log('  ↳ Filtered — skip');
        continue;
      }

      savedIds.push(id);
      incrementScraped();
      console.log(`  ↳ Saved [${savedIds.length}/${target}]`);
    } catch (err) {
      console.error(`  ↳ Error on Google card ${i + 1}:`, err);
    }
  }
}

async function scrapeGoogleJobsSearches(): Promise<string[]> {
  const savedIds: string[] = [];
  const target = resolvePortalTarget('priority');
  let driver: WebDriver | null = null;

  try {
    driver = await attachDriver(orangeProfile());
    console.log(`\n🔎 Google Jobs (United States) — stop at ${target} new jobs`);

    const searches = config.careerPortal.searches;
    for (let q = 0; q < searches.length; q++) {
      if (shouldAbortScrape() || savedIds.length >= target) break;
      console.log(`\n--- Google query ${q + 1}/${searches.length} (${savedIds.length}/${target} saved) ---`);
      await scrapeGoogleSearch(driver, searches[q], savedIds, target);
    }
  } finally {
    await releaseDriver(driver);
  }

  return savedIds;
}

/** Pipeline “career portals” phase — Google Jobs search (US). */
export async function scrapePriorityCareerPortals(): Promise<string[]> {
  return scrapeGoogleJobsSearches();
}

/** Same Google Jobs path (kept for scheduler / API compatibility). */
export async function scrapeAllCareerPortals(): Promise<string[]> {
  return scrapeGoogleJobsSearches();
}
