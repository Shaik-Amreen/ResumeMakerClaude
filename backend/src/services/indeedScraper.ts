import { By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { attachDriver, releaseDriver } from './chromeProfile';
import { saveJobIfNew } from './scrapeUtils';

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
  await driver.sleep(4000);

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

      let jobUrl = '';
      try {
        const link = await card.findElement(By.css('h2.jobTitle a, a.jcs-JobTitle, a[data-jk]'));
        jobUrl = (await link.getAttribute('href')) || '';
      } catch {
        continue;
      }

      if (!jobUrl) continue;

      await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', card);
      await driver.sleep(300);

      try {
        const link = await card.findElement(By.css('h2.jobTitle a, a.jcs-JobTitle, a[data-jk]'));
        await link.click();
      } catch {
        await driver.get(jobUrl);
      }

      await driver.sleep(2500);

      const description = await readTextIn(driver, [
        '#jobDescriptionText',
        '.jobsearch-jobDescriptionText',
        '[id*="jobDescription"]',
      ]);

      const pageUrl = await driver.getCurrentUrl();
      const applicants = await driver.executeScript(`
        const t = document.body.innerText || '';
        const m = t.match(/(?:Over\\s+)?[\\d,]+\\+?\\s+applicants?/i);
        return m ? m[0] : '';
      `);

      const id = await saveJobIfNew({
        title,
        company,
        url: pageUrl.split('?')[0] || jobUrl.split('?')[0],
        jobDescription: description,
        location: location || undefined,
        posted: posted || undefined,
        applicants: typeof applicants === 'string' && applicants ? applicants : undefined,
        source: 'indeed',
        forcedType,
      });

      if (id) {
        savedJobIds.push(id);
        console.log(`  ↳ Saved from Indeed [${savedJobIds.length}/${target}]`);
      } else {
        console.log('  ↳ Skipped (duplicate or filter)');
      }

      await driver.navigate().back();
      await driver.sleep(1500);
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
  jobType: 'internship' | 'fulltime' = 'internship'
): Promise<string[]> {
  const searches =
    jobType === 'fulltime' ? config.indeed.fullTimeSearches : config.indeed.searches;
  const target = scrapeRunTarget();
  if (!searches.length) return savedJobIds;

  let driver: WebDriver | null = null;
  try {
    driver = await attachDriver(orangeProfile());
    const label = jobType === 'fulltime' ? 'full-time software roles' : 'Summer 2027 software internships';
    console.log(`\n📰 Indeed — ${label} (newest first)`);

    for (let q = 0; q < searches.length; q++) {
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
