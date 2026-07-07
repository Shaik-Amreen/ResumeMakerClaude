import { By, WebDriver } from 'selenium-webdriver';
import Job from '../models/Job';
import { config } from '../config';
import { attachDriver, releaseDriver } from './chromeProfile';
import { resolvePostedAt } from '../utils/parsePostedDate';

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

async function refreshLinkedInJob(driver: WebDriver, url: string) {
  await driver.get(url);
  await driver.sleep(3000);

  const meta = await driver.executeScript(`
    const text = (document.body.innerText || '').slice(0, 4000);
    let applicants = '';
    let posted = '';
    const applicantEl = document.querySelector(
      '.jobs-unified-top-card__applicant-count, .num-applicants__caption, [class*="applicant-count"]'
    );
    if (applicantEl) applicants = (applicantEl.textContent || '').trim();
    const postedEl = document.querySelector(
      '.jobs-unified-top-card__posted-date, .posted-time-ago__text, [class*="posted-date"]'
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
    const closed = /no longer accepting applications|job is closed|this job is no longer/i.test(text);
    return { applicants, posted, closed };
  `);

  return meta as { applicants?: string; posted?: string; closed?: boolean };
}

async function refreshJobrightJob(driver: WebDriver, url: string) {
  await driver.get(url);
  await driver.sleep(3000);

  const meta = await driver.executeScript(`
    const text = document.body.innerText || '';
    let posted = '';
    const postedM = text.match(/\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i);
    if (postedM) posted = postedM[0];
    let applicants = '';
    const appM = text.match(/(?:Less than\\s+)?[\\d,]+\\+?\\s+applicants?/i);
    if (appM) applicants = appM[0];
    const closed = /no longer available|job has been filled|position filled/i.test(text);
    return { applicants, posted, closed };
  `);

  return meta as { applicants?: string; posted?: string; closed?: boolean };
}

async function refreshGenericJob(driver: WebDriver, url: string) {
  await driver.get(url);
  await driver.sleep(2500);

  const meta = await driver.executeScript(`
    const text = document.body.innerText || '';
    let posted = '';
    const postedM = text.match(/(?:Posted|Reposted)\\s+[^\\n·]{3,50}|\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i);
    if (postedM) posted = postedM[0].trim();
    let applicants = '';
    const appM = text.match(/(?:Over\\s+)?(?:Less than\\s+)?[\\d,]+\\+?\\s+applicants?/i);
    if (appM) applicants = appM[0];
    const closed = /no longer accepting|job is closed|position filled|expired/i.test(text);
    return { applicants, posted, closed };
  `);

  return meta as { applicants?: string; posted?: string; closed?: boolean };
}

function applyMeta(
  job: InstanceType<typeof Job>,
  meta: { applicants?: string; posted?: string; closed?: boolean }
) {
  if (meta.closed) {
    job.approvalNote = 'Listing may be closed — verify on site.';
  }
  if (meta.applicants) {
    job.applicants = meta.applicants;
    job.linkedinApplicants = meta.applicants;
  }
  if (meta.posted) {
    job.posted = meta.posted;
    job.linkedinPosted = meta.posted;
    job.postedAt = resolvePostedAt(meta.posted) ?? job.postedAt;
  }
}
async function refreshIndeedJob(driver: WebDriver, url: string) {
  await driver.get(url);
  await driver.sleep(2500);

  const meta = await driver.executeScript(`
    const text = document.body.innerText || '';
    let posted = '';
    const dateEl = document.querySelector('span.date, [data-testid="myJobsStateDate"]');
    if (dateEl) posted = (dateEl.textContent || '').trim();
    let applicants = '';
    const appM = text.match(/(?:Over\\s+)?[\\d,]+\\+?\\s+applicants?/i);
    if (appM) applicants = appM[0];
    const closed = /this job has expired|no longer available/i.test(text);
    return { posted, applicants, closed };
  `);

  return meta as { applicants?: string; posted?: string; closed?: boolean };
}

/** Re-visit every saved job URL and update posted date / applicant count. */
export async function refreshExistingJobs(): Promise<{ updated: number; closed: number }> {
  const jobs = await Job.find().sort({ updatedAt: 1 });
  let driver: WebDriver | null = null;
  let updated = 0;
  let closed = 0;

  try {
    driver = await attachDriver(orangeProfile());
    console.log(`\n🔄 Refreshing ${jobs.length} existing job listing(s)...`);

    for (const job of jobs) {
      try {
        const url = job.url.toLowerCase();
        let meta: { applicants?: string; posted?: string; closed?: boolean } = {};

        if (url.includes('linkedin.com')) {
          meta = await refreshLinkedInJob(driver, job.url);
        } else if (url.includes('jobright.ai')) {
          meta = await refreshJobrightJob(driver, job.url);
        } else if (url.includes('indeed.com')) {
          meta = await refreshIndeedJob(driver, job.url);
        } else {
          meta = await refreshGenericJob(driver, job.url);
        }

        if (meta.closed) closed += 1;
        applyMeta(job, meta);
        await job.save();
        updated += 1;
        console.log(`  Updated: ${job.title} @ ${job.company}${meta.posted ? ` · ${meta.posted}` : ''}`);
      } catch (err) {
        console.error(`  Refresh failed for ${job.title}:`, err);
      }
    }
  } finally {
    await releaseDriver(driver);
  }

  console.log(`\n✅ Refreshed ${updated} jobs (${closed} possibly closed).`);
  return { updated, closed };
}
