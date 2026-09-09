import { By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { attachDriver, releaseDriver } from './chromeProfile';
import { saveJobIfNew, gateCompanyForScrape } from './scrapeUtils';
import { shouldAbortScrape, scrapeSleep } from './scrapeContext';
import { appendTaskLog, incrementScraped, setTaskProgress } from './taskStatusService';
import { hydrateBestJobDescription, isLikelyEmployerApplyUrl } from './jdQuality';

function orangeProfile() {
  const { linkedin } = config;
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl: 'https://www.indeed.com/',
  };
}

async function readTextIn(root: WebElement | WebDriver, selectors: string[]): Promise<string> {
  for (const selector of selectors) {
    try {
      const el = await root.findElement(By.css(selector));
      const text = (await el.getText()).trim();
      if (text) return text;
    } catch {
      // try next
    }
  }
  return '';
}

async function getIndeedCards(driver: WebDriver): Promise<WebElement[]> {
  const selectors = [
    'div.job_seen_beacon',
    'li.css-5lfssm',
    '.jobsearch-ResultsList > li',
    '[data-jk]',
  ];
  for (const selector of selectors) {
    const cards = await driver.findElements(By.css(selector));
    if (cards.length) return cards;
  }
  return [];
}

async function scrapeIndeedSearch(
  driver: WebDriver,
  searchUrl: string,
  savedJobIds: string[],
  target: number,
  forcedType: 'internship' | 'fulltime' = 'internship'
): Promise<boolean> {
  console.log(`\n=== Indeed search (newest first) ===`);
  console.log(searchUrl);

  await driver.get(searchUrl);
  await scrapeSleep(4000);

  if (shouldAbortScrape()) {
    appendTaskLog('Indeed scrape stopped by user.');
    return true;
  }

  try {
    await driver.wait(until.elementLocated(By.css('div.job_seen_beacon, .jobsearch-ResultsList, [data-jk]')), 20000);
  } catch {
    console.log('No Indeed results found for this query.');
    return false;
  }

  const cards = await getIndeedCards(driver);
  const limit = Math.min(cards.length, config.indeed.maxJobsPerSearch);
  console.log(`Indeed: ${cards.length} cards — processing ${limit}`);

  for (let i = 0; i < limit; i++) {
    if (shouldAbortScrape()) {
      appendTaskLog('Indeed scrape stopped by user.');
      return true;
    }
    if (savedJobIds.length >= target) return true;

    try {
      const fresh = await getIndeedCards(driver);
      if (i >= fresh.length) break;
      const card = fresh[i];

      const title = await readTextIn(card, [
        'h2.jobTitle span',
        'h2.jobTitle',
        'a[data-jk]',
        '.jcs-JobTitle',
      ]);
      const company = await readTextIn(card, ['span[data-testid="company-name"]', '.companyName', '[data-testid="company-name"]']);
      const location = await readTextIn(card, ['div[data-testid="text-location"]', '.companyLocation']);
      const posted = await readTextIn(card, ['span.date', '[data-testid="myJobsStateDate"]', '.date']);

      console.log(`[Indeed ${i + 1}/${limit}] ${title || '?'} @ ${company || '?'}`);
      setTaskProgress(i + 1, limit, `Indeed ${i + 1}/${limit}`);

      // FIRST: verify company before opening Indeed detail
      if (!company || !(await gateCompanyForScrape(company))) {
        continue;
      }

      let jobUrl = '';
      try {
        const link = await card.findElement(By.css('h2.jobTitle a, a.jcs-JobTitle, a[data-jk]'));
        jobUrl = (await link.getAttribute('href')) || '';
      } catch {
        continue;
      }

      if (!jobUrl) continue;

      await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', card);
      await scrapeSleep(300);

      try {
        const link = await card.findElement(By.css('h2.jobTitle a, a.jcs-JobTitle, a[data-jk]'));
        await link.click();
      } catch {
        await driver.get(jobUrl);
      }

      await scrapeSleep(2500);

      if (shouldAbortScrape()) return true;

      const description = await readTextIn(driver, [
        '#jobDescriptionText',
        '.jobsearch-jobDescriptionText',
        '[id*="jobDescription"]',
      ]);

      const pageUrl = await driver.getCurrentUrl();
      // Prefer employer career URL when Indeed exposes "Apply on company site".
      const companyApplyUrl = (await driver.executeScript(`
        const links = Array.from(document.querySelectorAll('a[href]'));
        const hit = links.find((a) => {
          const t = (a.innerText || a.getAttribute('aria-label') || '').toLowerCase();
          const href = a.href || '';
          if (/indeed\\.com|indeedapply/i.test(href)) return false;
          return /apply on company|company site|apply now|view job/i.test(t) && /^https?:/i.test(href);
        });
        return hit ? hit.href : '';
      `)) as string;

      const applicants = await driver.executeScript(`
        const t = document.body.innerText || '';
        const m = t.match(/(?:Over\\s+)?[\\d,]+\\+?\\s+applicants?/i);
        return m ? m[0] : '';
      `);

      const applyUrl =
        companyApplyUrl && isLikelyEmployerApplyUrl(companyApplyUrl)
          ? companyApplyUrl.split('?')[0]
          : pageUrl.split('?')[0] || jobUrl.split('?')[0];

      const hydrated = await hydrateBestJobDescription({
        boardText: description,
        applyUrl: isLikelyEmployerApplyUrl(applyUrl) ? applyUrl : undefined,
        allowSelenium: true,
      });
      const jobDescription = hydrated.text || description;

      const id = await saveJobIfNew({
        title,
        company,
        url: applyUrl,
        jobDescription,
        location: location || undefined,
        posted: posted || undefined,
        applicants: typeof applicants === 'string' && applicants ? applicants : undefined,
        source: 'indeed',
        forcedType,
      });

      if (id) {
        savedJobIds.push(id);
        incrementScraped();
        console.log(`  ↳ Saved from Indeed [${savedJobIds.length}/${target}]`);
      } else {
        console.log('  ↳ Skipped (duplicate or filter)');
      }

      await driver.navigate().back();
      await scrapeSleep(1500);
    } catch (err) {
      console.error(`  ↳ Indeed card error:`, err);
      try {
        await driver.navigate().back();
      } catch {
        // ignore
      }
    }
  }

  return savedJobIds.length >= target;
}

export async function scrapeIndeedJobs(
  savedJobIds: string[],
  _jobType: 'internship' | 'fulltime' = 'fulltime'
): Promise<string[]> {
  const jobType = 'fulltime' as const;
  const searches = config.indeed.fullTimeSearches;
  const target = scrapeRunTarget();
  if (!searches.length) return savedJobIds;

  let driver: WebDriver | null = null;
  try {
    driver = await attachDriver(orangeProfile());
    const label = 'full-time software roles';
    console.log(`\n📰 Indeed — ${label} (newest first)`);

    for (let q = 0; q < searches.length; q++) {
      if (shouldAbortScrape()) {
        appendTaskLog('Indeed scrape stopped by user.');
        break;
      }
      if (savedJobIds.length >= target) break;
      console.log(`\n--- Indeed query ${q + 1}/${searches.length} (${savedJobIds.length}/${target}) ---`);
      const stop = await scrapeIndeedSearch(driver, searches[q], savedJobIds, target, jobType);
      if (stop) break;
    }
  } finally {
    await releaseDriver(driver);
  }

  return savedJobIds;
}
