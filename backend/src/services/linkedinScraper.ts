import { By, until, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { attachDriver, releaseDriver } from './chromeProfile';
import { syncOrangeSession } from './cookieSync';
import { inferJobType, isSoftwareRole } from './eligibility';
import { isDuplicateJob } from './jobDedup';
import { isUndergraduateOnlyJob } from './jobSkipRules';
import { saveJobIfNew, gateCompanyForScrape } from './scrapeUtils';
import { shouldAbortScrape } from './scrapeContext';
import {
  appendTaskLog,
  incrementScraped,
  logScrapingUrl,
  setTaskProgress,
} from './taskStatusService';
import { hydrateBestJobDescription } from './jdQuality';

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

async function readFromCard(driver: WebDriver, card: WebElement) {
  const extracted = (await driver.executeScript(
    `
    const card = arguments[0];
    const titleEl = card.querySelector('.job-card-list__title--link, .job-card-container__link strong, a[href*="/jobs/view/"]');
    const companyEl = card.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle');
    const locEl = card.querySelector('.job-card-container__metadata-item, .artdeco-entity-lockup__caption');
    const appEl = card.querySelector('.job-card-container__applicant-count, .job-card-list__footer-item');
    const link = card.querySelector('a[href*="/jobs/view/"], a[href*="/jobs/collections/"]');
    let href = link ? (link.href || link.getAttribute('href') || '') : '';
    const jobId = card.getAttribute('data-job-id') || card.querySelector('[data-job-id]')?.getAttribute('data-job-id');
    if (!href && jobId) href = 'https://www.linkedin.com/jobs/view/' + jobId + '/';
    return {
      title: (titleEl?.textContent || '').trim(),
      company: (companyEl?.textContent || '').trim(),
      location: (locEl?.textContent || '').trim(),
      applicants: (appEl?.textContent || '').trim(),
      href,
    };
  `,
    card
  )) as {
    title: string;
    company: string;
    location: string;
    applicants: string;
    href: string;
  };

  const url = extracted.href ? normalizeJobUrl(extracted.href) : null;

  return {
    title: extracted.title,
    company: extracted.company,
    location: extracted.location,
    url,
    linkedinApplicants: extracted.applicants || undefined,
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

async function waitForJobDetail(driver: WebDriver, expectedTitle?: string): Promise<WebElement> {
  try {
    return await waitForDetailPane(driver, expectedTitle);
  } catch {
    /* split-pane failed — may be on full job page */
  }

  const fullPageSelectors = ['.jobs-description__content', '#job-details', '.jobs-box__html-content'];
  for (const sel of fullPageSelectors) {
    try {
      const el = await driver.wait(until.elementLocated(By.css(sel)), 12000);
      await driver.wait(until.elementIsVisible(el), 8000);
      return el;
    } catch {
      // try next
    }
  }

  throw new Error('Job detail did not load.');
}

async function openJobListing(
  driver: WebDriver,
  card: WebElement,
  fromCard: { title: string; url: string | null }
): Promise<WebElement | WebDriver> {
  if (fromCard.url) {
    logScrapingUrl(fromCard.url, fromCard.title || 'LinkedIn job');
    await driver.get(fromCard.url);
    await driver.sleep(2500);
    await waitForJobDetail(driver, fromCard.title);
    return driver;
  }

  await driver.executeScript('arguments[0].scrollIntoView({ block: "center" });', card);
  await driver.sleep(500);

  try {
    await driver.executeScript('arguments[0].click();', card);
  } catch {
    await card.click();
  }
  await driver.sleep(1500);
  return waitForJobDetail(driver, fromCard.title);
}

async function readLinkedInMetaFromPage(driver: WebDriver) {
  const meta = await driver.executeScript(`
    const text = (document.body.innerText || '').slice(0, 4000);
    let applicants = '';
    let posted = '';
    const m1 = text.match(/(?:Over\\s+)?[\\d,]+\\+?\\s+applicants?/i);
    if (m1) applicants = m1[0];
    const m2 = text.match(/(?:Reposted|Posted)\\s+[^\\n·]{3,50}/i);
    if (m2) posted = m2[0].trim();
    return { applicants, posted };
  `);
  const result = meta as { applicants?: string; posted?: string };
  return {
    applicants: result.applicants?.trim() || undefined,
    posted: result.posted?.trim() || undefined,
  };
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

async function expandLinkedInDescription(driver: WebDriver, pane: WebElement | WebDriver) {
  try {
    await driver.executeScript(
      `
      const root = arguments[0] || document;
      const buttons = [...root.querySelectorAll('button, a')];
      const seeMore = buttons.find((b) =>
        /^(see more|show more|…see more|see more)$/i.test((b.innerText || b.textContent || '').trim())
        || /see more|show more/i.test(b.getAttribute('aria-label') || '')
      );
      if (seeMore) seeMore.click();
      const footer = root.querySelector(
        '.jobs-description__footer button, .jobs-description-content__footer button, button.jobs-description__footer-button'
      );
      if (footer) footer.click();
      `,
      pane === driver ? null : pane
    );
    await driver.sleep(600);
  } catch {
    // optional — collapsed JD is still better than nothing
  }
}

async function readLinkedInCompanyApplyUrl(
  driver: WebDriver,
  pane: WebElement | WebDriver
): Promise<string | undefined> {
  try {
    const href = (await driver.executeScript(
      `
      const root = arguments[0] || document;
      const links = [...root.querySelectorAll('a[href]')];
      const company = links.find((a) =>
        /company website|apply on company|offsite apply|external apply/i.test(
          (a.innerText || a.textContent || a.getAttribute('aria-label') || '')
        )
      );
      if (company?.href) return company.href;
      const offsite = root.querySelector(
        'a[href*="linkedin.com/jobs/view"] ~ a[href^="http"], a.jobs-apply-button--company-link, a[data-control-name="jobdetails_topcard_inapply"]'
      );
      return offsite?.href || '';
      `,
      pane === driver ? null : pane
    )) as string;
    if (href && !/linkedin\.com/i.test(href)) return href.split('?')[0];
  } catch {
    // optional
  }
  return undefined;
}

async function readDetailPane(driver: WebDriver, pane: WebElement | WebDriver) {
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
  const meta =
    pane === driver
      ? await readLinkedInMetaFromPage(driver)
      : await readLinkedInMeta(driver, pane as WebElement);

  await expandLinkedInDescription(driver, pane);

  const description = await readTextIn(pane, [
    '.jobs-description__content',
    '#job-details',
    '.jobs-box__html-content',
  ]);
  const companyApplyUrl = await readLinkedInCompanyApplyUrl(driver, pane);
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
    companyApplyUrl,
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
    if (shouldAbortScrape()) {
      appendTaskLog('LinkedIn scrape stopped by user.');
      return true;
    }

    if (savedJobIds.length >= target) {
      console.log(`Reached ${target} jobs — stopping this search.`);
      return true;
    }

    try {
      const freshCards = await getJobCards(driver);
      if (i >= freshCards.length) break;

      const card = freshCards[i];
      const fromCard = await readFromCard(driver, card);

      console.log(`[${i + 1}/${limit}] ${fromCard.title || 'Unknown'} @ ${fromCard.company || '?'}`);
      setTaskProgress(i + 1, limit, `LinkedIn card ${i + 1}/${limit}`);

      if (fromCard.url) {
        const dup = await isDuplicateJob(fromCard.url, fromCard.title || '', fromCard.company || '');
        if (dup) {
          console.log('  ↳ Duplicate — skip');
          continue;
        }
      }

      if (isUndergraduateOnlyJob(fromCard.title || '', '')) {
        console.log('  ↳ Skipped — undergraduate only (title)');
        continue;
      }

      // FIRST: verify company before opening detail pane / employer JD hydrate
      if (!(await gateCompanyForScrape(fromCard.company || ''))) {
        continue;
      }

      const pane = await openJobListing(driver, card, {
        title: fromCard.title,
        url: fromCard.url,
      });
      const details = await readDetailPane(driver, pane);

      const title = details.title || fromCard.title;
      const company = details.company || fromCard.company;
      const url =
        fromCard.url ||
        normalizeJobUrl(await driver.getCurrentUrl()) ||
        (await driver.getCurrentUrl()).split('?')[0];

      const hydrated = await hydrateBestJobDescription({
        boardText: details.description,
        applyUrl: details.companyApplyUrl,
        allowSelenium: true,
      });
      const description = hydrated.text || details.description;

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
        pipelinePhase: 'linkedin',
      });

      if (!id) {
        console.log('  ↳ Duplicate or filtered — skip');
        continue;
      }

      savedJobIds.push(id);
      saved += 1;
      incrementScraped();
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
  _jobType: 'internship' | 'fulltime' = 'fulltime'
): Promise<string[]> {
  const jobType = 'fulltime' as const;
  const savedJobIds: string[] = [...existingIds];
  let driver: WebDriver | null = null;
  try {
    const searches = config.linkedin.fullTimeSearches;
    const target = scrapeRunTarget();
    if (!searches.length) {
      throw new Error(`No ${jobType} search URLs configured.`);
    }

    driver = await attachDriver(orangeProfile());
    await syncOrangeSession(driver, searches[0]);

    const label = 'full-time software roles';
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
