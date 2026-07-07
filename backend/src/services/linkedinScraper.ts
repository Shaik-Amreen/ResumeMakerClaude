import { By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { attachDriver, releaseDriver } from './chromeProfile';
import { syncOrangeSession } from './cookieSync';
import { inferJobType, isSoftwareRole } from './eligibility';
import { isDuplicateJob } from './jobDedup';
import { saveJobIfNew } from './scrapeUtils';

function orangeProfile() {
  const { linkedin } = config;
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl: 'https://www.linkedin.com/jobs/',
  };
}

function normalizeJobUrl(href: string): string | null {
  if (!href || !href.includes('/jobs/')) return null;
  const path = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
  return path.split('?')[0];
}

async function scrollJobList(driver: WebDriver) {
  const listSelectors = [
    '.jobs-search-results-list',
    '.scaffold-layout__list',
    '.jobs-search__results-list',
  ];

  for (const selector of listSelectors) {
    try {
      const list = await driver.findElement(By.css(selector));
      for (let i = 0; i < 4; i++) {
        await driver.executeScript(
          'arguments[0].scrollTop = arguments[0].scrollHeight',
          list
        );
        await driver.sleep(1000);
      }
      return;
    } catch {
      // try next
    }
  }
}

async function getJobCards(driver: WebDriver): Promise<WebElement[]> {
  const selectors = [
    'li.jobs-search-results__list-item',
    '.job-card-container',
    'div[data-job-id]',
  ];

  for (const selector of selectors) {
    const cards = await driver.findElements(By.css(selector));
    if (cards.length) return cards;
  }
  return [];
}

async function readFromCard(card: WebElement) {
  const title = await readTextIn(card, [
    '.job-card-list__title--link',
    '.job-card-container__link strong',
    'a[href*="/jobs/view/"]',
  ]);
  const company = await readTextIn(card, [
    '.job-card-container__company-name',
    '.artdeco-entity-lockup__subtitle',
    '.job-card-container__primary-description',
  ]);
  const location = await readTextIn(card, [
    '.job-card-container__metadata-item',
    '.artdeco-entity-lockup__caption',
  ]);
  const linkedinApplicants = await readTextIn(card, [
    '.job-card-container__applicant-count',
    '.job-card-list__footer-item',
  ]);

  let url: string | null = null;
  try {
    const link = await card.findElement(By.css('a[href*="/jobs/view/"], a[href*="/jobs/collections/"]'));
    const href = await link.getAttribute('href');
    url = href ? normalizeJobUrl(href) : null;
  } catch {
    // no link on card
  }

  return { title, company, location, url, linkedinApplicants: linkedinApplicants || undefined };
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

async function waitForDetailPane(driver: WebDriver, expectedTitle?: string) {
  const paneSelectors = [
    '.jobs-search__job-details--container',
    '.jobs-search__right-rail',
    '.scaffold-layout__detail',
  ];

  for (const paneSelector of paneSelectors) {
    try {
      const pane = await driver.wait(until.elementLocated(By.css(paneSelector)), 10000);
      await driver.wait(until.elementIsVisible(pane), 8000);

      if (expectedTitle) {
        await driver.wait(async () => {
          const currentTitle = await readTextIn(pane, [
            '.job-details-jobs-unified-top-card__job-title',
            '.jobs-unified-top-card__job-title',
            'h1',
          ]);
          return currentTitle.toLowerCase().includes(expectedTitle.toLowerCase().slice(0, 20));
        }, 10000);
      }

      const descSelectors = [
        '.jobs-description__content',
        '#job-details',
        '.jobs-box__html-content',
      ];
      for (const sel of descSelectors) {
        try {
          const desc = await pane.findElement(By.css(sel));
          await driver.wait(until.elementIsVisible(desc), 8000);
          await driver.executeScript(
            'arguments[0].scrollIntoView({ block: "start" });',
            desc
          );
          await driver.sleep(800);
          return pane;
        } catch {
          // try next
        }
      }
    } catch {
      // try next pane selector
    }
  }

  throw new Error('Job detail pane did not load.');
}

async function readLinkedInMeta(driver: WebDriver, pane: WebElement) {
  const meta = await driver.executeScript(
    `const pane = arguments[0];
     const text = (pane.innerText || '').slice(0, 3000);
     let applicants = '';
     let posted = '';
     const applicantEl = pane.querySelector(
       '.jobs-unified-top-card__applicant-count, .num-applicants__caption, .jobs-details-top-card__apply-count, [class*="applicant-count"]'
     );
     if (applicantEl) applicants = (applicantEl.textContent || '').trim();
     const postedEl = pane.querySelector(
       '.jobs-unified-top-card__posted-date, .posted-time-ago__text, [class*="posted-date"], [class*="posted-time"]'
     );
     if (postedEl) posted = (postedEl.textContent || '').trim();
     if (!applicants) {
       const m = text.match(/(?:Over\\s+)?[\\d,]+\\+?\\s+applicants?/i);
       if (m) applicants = m[0];
     }
     if (!posted) {
       const m = text.match(/(?:Reposted|Posted)\\s+[^\\n·]{3,50}/i);
       if (m) posted = m[0].trim();
     }
     return { applicants, posted };`,
    pane
  );
  const result = meta as { applicants?: string; posted?: string };
  return {
    applicants: result.applicants?.trim() || undefined,
    posted: result.posted?.trim() || undefined,
  };
}

async function readDetailPane(driver: WebDriver, pane: WebElement) {
  const title = await readTextIn(pane, [
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    'h1.t-24',
    'h1',
  ]);
  const company = await readTextIn(pane, [
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name',
  ]);
  const location = await readTextIn(pane, [
    '.job-details-jobs-unified-top-card__bullet',
    '.jobs-unified-top-card__bullet',
  ]);
  const meta = await readLinkedInMeta(driver, pane);
  const description = await readTextIn(pane, [
    '.jobs-description__content',
    '#job-details',
    '.jobs-box__html-content',
  ]);
  const recruiterName = await readTextIn(pane, [
    '.jobs-poster__name',
    '.hirer-card__hirer-information',
  ]);

  let recruiterProfileUrl = '';
  try {
    const link = await pane.findElement(By.css('.jobs-poster a, .hirer-card__hirer-link'));
    recruiterProfileUrl = (await link.getAttribute('href')) || '';
  } catch {
    // optional
  }

  return {
    title,
    company,
    location,
    description,
    recruiterName,
    recruiterProfileUrl,
    linkedinApplicants: meta.applicants,
    linkedinPosted: meta.posted,
  };
}

async function scrapeSearchPage(
  driver: WebDriver,
  searchUrl: string,
  savedJobIds: string[],
  forcedType?: 'internship' | 'fulltime'
): Promise<boolean> {
  console.log(`\n=== Scraping search (${forcedType || 'auto'}) — single page ===`);
  console.log(searchUrl);

  await driver.get(searchUrl);
  await driver.sleep(4000);

  await driver.wait(
    until.elementLocated(
      By.css('.jobs-search-results-list, .job-card-container, li.jobs-search-results__list-item')
    ),
    25000
  );

  await scrollJobList(driver);

  const cards = await getJobCards(driver);
  const limit = Math.min(cards.length, config.linkedin.maxJobsPerSearch);
  console.log(`Found ${cards.length} cards — processing ${limit} on this page.`);

  let saved = 0;

  const target = scrapeRunTarget();

  for (let i = 0; i < limit; i++) {
    if (savedJobIds.length >= target) {
      console.log(`Reached ${target} jobs — stopping this search.`);
      return true;
    }

    try {
      const freshCards = await getJobCards(driver);
      if (i >= freshCards.length) break;

      const card = freshCards[i];
      const fromCard = await readFromCard(card);

      console.log(`[${i + 1}/${limit}] ${fromCard.title || 'Unknown'} @ ${fromCard.company || '?'}`);

      if (fromCard.url) {
        const dup = await isDuplicateJob(fromCard.url, fromCard.title || '', fromCard.company || '');
        if (dup) {
          console.log('  ↳ Duplicate — skip');
          continue;
        }
      }

      await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
      await driver.sleep(400);
      await card.click();

      const pane = await waitForDetailPane(driver, fromCard.title);
      const details = await readDetailPane(driver, pane);

      const title = details.title || fromCard.title;
      const company = details.company || fromCard.company;
      const description = details.description;
      const url =
        fromCard.url ||
        normalizeJobUrl(await driver.getCurrentUrl()) ||
        (await driver.getCurrentUrl()).split('?')[0];

      if (!title || !company || !description) {
        console.warn(
          `  ↳ Skipped — missing data (title=${!!title}, company=${!!company}, desc=${!!description})`
        );
        continue;
      }

      if (!isSoftwareRole(title, description)) {
        console.log('  ↳ Skipped — not software (hardware/radar/FPGA/etc.)');
        continue;
      }

      const jobType = forcedType || inferJobType(title, description);

      const id = await saveJobIfNew({
        title,
        company,
        url,
        jobDescription: description,
        location: details.location || fromCard.location || undefined,
        recruiterName: details.recruiterName || undefined,
        recruiterProfileUrl: details.recruiterProfileUrl || undefined,
        applicants: details.linkedinApplicants || fromCard.linkedinApplicants || undefined,
        posted: details.linkedinPosted || undefined,
        source: 'linkedin',
        forcedType: jobType,
      });

      if (!id) {
        console.log('  ↳ Duplicate or filtered — skip');
        continue;
      }

      savedJobIds.push(id);
      saved += 1;
      console.log(`  ↳ Saved to tracker (${jobType}) [${savedJobIds.length}/${target}]`);

      if (savedJobIds.length >= target) {
        console.log(`Reached ${target} jobs — stopping scrape.`);
        return true;
      }
    } catch (err) {
      console.error(`  ↳ Error on card ${i + 1}:`, err);
    }
  }

  console.log(`Done — saved ${saved} jobs from this search.`);
  return savedJobIds.length >= target;
}

/** Scrape LinkedIn until scrapeTargetTotal new jobs saved. Returns all IDs saved this run. */
export async function scrapeLinkedInJobs(
  existingIds: string[] = [],
  jobType: 'internship' | 'fulltime' = 'internship'
): Promise<string[]> {
  const savedJobIds: string[] = [...existingIds];
  let driver: WebDriver | null = null;
  try {
    const searches =
      jobType === 'fulltime' ? config.linkedin.fullTimeSearches : config.linkedin.internshipSearches;
    const target = scrapeRunTarget();
    if (!searches.length) {
      throw new Error(`No ${jobType} search URLs configured.`);
    }

    driver = await attachDriver(orangeProfile());
    await syncOrangeSession(driver, searches[0]);

    const label =
      jobType === 'fulltime' ? 'full-time software roles' : 'Summer 2027 internship';
    console.log(`\n🔍 LinkedIn ${label} scrape — stop at ${target} new jobs`);

    for (let q = 0; q < searches.length; q++) {
      if (savedJobIds.length >= target) break;

      console.log(`\n--- Query ${q + 1}/${searches.length} (${savedJobIds.length}/${target} saved) ---`);
      const stop = await scrapeSearchPage(driver, searches[q], savedJobIds, jobType);
      if (stop) break;
    }

    console.log(`\n✅ LinkedIn scrape finished — ${savedJobIds.length} new jobs saved.`);
    return savedJobIds;
  } catch (error) {
    console.error('LinkedIn scraping failed:', error);
    throw error;
  } finally {
    await releaseDriver(driver);
  }
}
