import { WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import { schedulerPortalTarget } from '../utils/scrapeLimits';
import {
  CompanyTarget,
  EXTENDED_CAREER_COMPANIES,
  FAANG_MANGO_COMPANIES,
} from '../data/priorityCompanies';
import { attachDriver, releaseDriver } from './chromeProfile';
import { saveJobIfNew, type ScrapeSource } from './scrapeUtils';

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

async function extractJobLinks(driver: WebDriver, baseHost: string): Promise<{ title: string; href: string }[]> {
  const links = await driver.executeScript(`
    const host = arguments[0].toLowerCase();
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href || '';
      const text = (a.textContent || '').trim();
      if (!href || !text || text.length < 8 || text.length > 120) continue;
      if (!/intern|internship|co-?op|university|early\\s+career/i.test(text)) continue;
      if (!/software|developer|engineer|swe|full[\\s-]?stack|web|frontend|backend|computer\\s+science/i.test(text)) continue;
      try {
        const u = new URL(href);
        if (!u.hostname.toLowerCase().includes(host) && !href.includes('myworkdayjobs') && !href.includes('lever.co') && !href.includes('greenhouse')) continue;
      } catch { continue; }
      const key = href.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title: text, href: key });
      if (out.length >= 12) break;
    }
    return out;
  `, baseHost);

  return Array.isArray(links) ? (links as { title: string; href: string }[]) : [];
}

async function readPageMeta(driver: WebDriver): Promise<{ posted?: string; applicants?: string }> {
  const meta = await driver.executeScript(`
    const text = document.body.innerText || '';
    let posted = '';
    const postedM = text.match(/(?:Posted|Reposted)\\s+[^\\n·]{3,50}|\\d+\\s+(minute|hour|day|week|month)s?\\s+ago/i);
    if (postedM) posted = postedM[0].trim();
    let applicants = '';
    const appM = text.match(/(?:Over\\s+)?(?:Less than\\s+)?[\\d,]+\\+?\\s+applicants?/i);
    if (appM) applicants = appM[0];
    return { posted, applicants };
  `);
  return (meta as { posted?: string; applicants?: string }) || {};
}

async function readJobDescription(driver: WebDriver): Promise<string> {
  const text = await driver.executeScript(`
    const selectors = [
      '[class*="description"]', '[class*="job-description"]', '[data-automation-id="jobPostingDescription"]',
      'article', 'main', '.content'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = (el?.innerText || '').trim();
      if (t.length > 200) return t.slice(0, 12000);
    }
    return (document.body.innerText || '').slice(0, 12000);
  `);
  return typeof text === 'string' ? text.trim() : '';
}

async function scrapeCompanyPortal(
  driver: WebDriver,
  company: CompanyTarget,
  savedIds: string[],
  target: number
): Promise<string[]> {
  console.log(`\n🏢 ${company.name} (${company.tier}) — ${company.searchUrl}`);

  try {
    await driver.get(company.searchUrl);
    await driver.sleep(4000);
  } catch (err) {
    console.error(`  ↳ Could not load ${company.name}:`, err);
    return savedIds;
  }

  let host = '';
  try {
    host = new URL(company.searchUrl).hostname.replace(/^www\./, '');
  } catch {
    host = company.name.toLowerCase();
  }

  const links = await extractJobLinks(driver, host);
  console.log(`  Found ${links.length} intern posting link(s)`);

  for (const link of links) {
    if (savedIds.length >= target) break;

    try {
      await driver.get(link.href);
      await driver.sleep(2500);

      const description = await readJobDescription(driver);
      const meta = await readPageMeta(driver);
      const pageTitle = await driver.getTitle();
      const title = link.title || pageTitle.split('|')[0].trim() || 'Software Engineering Intern';

      const priority = company.tier === 'faang' || company.tier === 'mango' ? 'faang' : 'standard';

      const id = await saveJobIfNew({
        title,
        company: company.name,
        url: (await driver.getCurrentUrl()).split('?')[0],
        jobDescription: description || `${title} at ${company.name}. Open career portal for full JD.`,
        posted: meta.posted,
        applicants: meta.applicants,
        source: 'career_portal' as ScrapeSource,
        forcedType: 'internship',
        priority,
      });

      if (!id) {
        console.log(`  ↳ Skip: ${title}`);
        continue;
      }

      savedIds.push(id);
      console.log(`  ↳ Saved [${savedIds.length}]: ${title}`);
    } catch (err) {
      console.error(`  ↳ Error on ${link.href}:`, err);
    }
  }

  return savedIds;
}

export async function scrapePriorityCareerPortals(): Promise<number> {
  const savedIds: string[] = [];
  const target = schedulerPortalTarget('priority');
  let driver: WebDriver | null = null;

  try {
    driver = await attachDriver(orangeProfile());
    console.log('\n⭐ FAANG + MANGOES career portal scan');

    for (const company of FAANG_MANGO_COMPANIES) {
      if (savedIds.length >= target) break;
      await scrapeCompanyPortal(driver, company, savedIds, target);
    }
  } finally {
    await releaseDriver(driver);
  }

  return savedIds.length;
}

export async function scrapeAllCareerPortals(): Promise<number> {
  const savedIds: string[] = [];
  const target = schedulerPortalTarget('night');
  let driver: WebDriver | null = null;

  try {
    driver = await attachDriver(orangeProfile());
    console.log('\n🌙 All career portal scan (11 PM – 8 AM window)');

    for (const company of EXTENDED_CAREER_COMPANIES) {
      if (savedIds.length >= target) break;
      await scrapeCompanyPortal(driver, company, savedIds, target);
    }
  } finally {
    await releaseDriver(driver);
  }

  return savedIds.length;
}
