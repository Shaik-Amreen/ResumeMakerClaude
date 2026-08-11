import { By, WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import { FAANG_PRIORITY_PORTALS } from '../data/faangPriorityPortals';
import { attachDriver, releaseDriver } from './chromeProfile';
import { saveJobIfNew, type ScrapeSource } from './scrapeUtils';
import { isDuplicateJob } from './jobDedup';
import { shouldAbortScrape, scrapeSleep } from './scrapeContext';
import { appendTaskLog, incrementScraped, logScrapingUrl, setTaskProgress } from './taskStatusService';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { unlimitedScrapeTarget } from '../utils/scrapeLimits';

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function orangeProfile() {
  const { linkedin } = config;
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl: 'https://www.amazon.jobs/',
  };
}

interface PortalJob {
  title: string;
  company: string;
  url: string;
  jobDescription: string;
  location?: string;
  posted?: string;
}

async function fetchAmazonJobs(query: string): Promise<PortalJob[]> {
  const url =
    `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(query)}` +
    `&loc_query=${encodeURIComponent('United States')}&normalized_country_code[]=USA&result_limit=50&sort=relevant`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (job-tracker)' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      jobs?: Array<{
        title?: string;
        job_path?: string;
        location?: string;
        description?: string;
        description_short?: string;
        basic_qualifications?: string;
        preferred_qualifications?: string;
        posted_date?: string;
        company_name?: string;
      }>;
    };
    return (data.jobs || []).map((j) => {
      const path = j.job_path || '';
      const abs = path.startsWith('http') ? path : `https://www.amazon.jobs${path}`;
      const desc = [
        stripHtml(j.description || j.description_short || ''),
        stripHtml(j.basic_qualifications || ''),
        stripHtml(j.preferred_qualifications || ''),
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        title: (j.title || '').trim(),
        company: j.company_name?.trim() || 'Amazon',
        url: abs,
        jobDescription: desc || `${j.title} internship at Amazon. Summer software engineering internship.`,
        location: j.location || 'United States',
        posted: j.posted_date,
      };
    });
  } catch (err) {
    console.error('Amazon API scrape failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function harvestJobLinks(driver: WebDriver, company: string): Promise<string[]> {
  const hrefs = (await driver.executeScript(`
    const out = new Set();
    const host = location.hostname;
    for (const a of document.querySelectorAll('a[href]')) {
      let href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      try {
        const u = new URL(href, location.href);
        if (u.hostname !== host && !u.hostname.includes(host.split('.').slice(-2).join('.'))) {
          // allow careers subdomains of same brand
          if (!u.hostname.includes('${company.toLowerCase()}') &&
              !/(amazon|microsoft|meta|facebook|apple|google|apply\\.careers)\\./i.test(u.hostname)) continue;
        }
        const path = u.pathname.toLowerCase();
        if (!/(job|jobs|careers|position|internship|details|posting|requisition|\\/en\\/jobs\\/)/i.test(path + u.search)) continue;
        if (/(login|signin|signup|help|privacy|legal|cookie)/i.test(path)) continue;
        // Prefer detail-ish URLs over pure search
        if (/\\/search\\/?$/i.test(path) && !u.search) continue;
        out.add(u.origin + u.pathname + u.search);
      } catch {}
    }
    return [...out].slice(0, 40);
  `)) as string[];
  return hrefs || [];
}

async function readJobPage(driver: WebDriver, company: string): Promise<PortalJob | null> {
  const data = (await driver.executeScript(`
    const text = (document.body && document.body.innerText) || '';
    const pick = (sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        const t = (el && (el.innerText || el.textContent) || '').trim();
        if (t && t.length < 200) return t;
      }
      return '';
    };
    let title = pick(['h1', 'h2', '[data-test="job-title"]', '.job-title', '[class*="JobTitle"]']);
    if (!title) {
      const line = text.split('\\n').map(l => l.trim()).find(l => l.length > 8 && l.length < 120);
      title = line || document.title || '';
    }
    const descEl = document.querySelector(
      '[class*="description"], [data-test="job-description"], #job-description, article, main'
    );
    let description = descEl ? (descEl.innerText || '').trim() : '';
    if (description.length < 120) description = text.slice(0, 8000);
    let location = pick(['[class*="location"]', '[data-test="location"]', '[aria-label*="location" i]']);
    return { title, description, location, url: location.href };
  `)) as { title: string; description: string; location: string; url: string };

  if (!data?.title || data.title.length < 4) return null;
  return {
    title: data.title.trim(),
    company,
    url: data.url || (await driver.getCurrentUrl()),
    jobDescription:
      data.description?.trim() ||
      `${data.title} — software engineering internship at ${company}. Summer 2027.`,
    location: data.location || 'United States',
  };
}

async function savePortalJobs(
  jobs: PortalJob[],
  savedIds: string[],
  target: number,
  source: ScrapeSource
): Promise<void> {
  for (const job of jobs) {
    if (shouldAbortScrape() || savedIds.length >= target) return;
    if (!job.title || !job.url) continue;
    if (await isDuplicateJob(job.url, job.title, job.company)) continue;

    const id = await saveJobIfNew({
      title: job.title,
      company: job.company,
      url: job.url,
      jobDescription: job.jobDescription,
      location: job.location || 'United States',
      posted: job.posted,
      source,
      forcedType: 'internship',
      priority: 'faang',
      pipelinePhase: 'career_portal',
    });
    if (!id) continue;
    savedIds.push(id);
    incrementScraped();
    setTaskProgress(savedIds.length, target, `${job.company} — ${job.title}`);
    appendTaskLog(`  ✓ Saved [${savedIds.length}/${target}] ${job.company}: ${job.title}`);
    console.log(`  ↳ [FAANG/${job.company}] Saved: ${job.title}`);
  }
}

/**
 * Phase 1 — Amazon / Microsoft / Meta / Apple / Google university internship portals.
 */
export async function scrapeFaangPriorityPortals(existingIds: string[] = []): Promise<string[]> {
  const savedIds = [...existingIds];
  const target = scrapeRunTarget();
  appendTaskLog(`FAANG portals (up to ${target} new)…`);
  console.log(`\n⭐ FAANG priority portals — target ${target}`);

  // Amazon JSON API (no browser)
  const amazonQueries = [
    'Software Development Engineer Intern 2027',
    'SDE Intern Summer 2027',
    'software engineering intern 2027',
    'Software Development Engineer Intern',
  ];
  for (const q of amazonQueries) {
    if (shouldAbortScrape() || savedIds.length >= target) break;
    appendTaskLog(`Amazon API search: "${q}"`);
    const jobs = await fetchAmazonJobs(q);
    appendTaskLog(`  Amazon API "${q}": ${jobs.length} hit(s)`);
    console.log(`  Amazon API "${q}": ${jobs.length} hit(s)`);
    await savePortalJobs(jobs, savedIds, target, 'company_portal');
  }

  // Browser harvest for Microsoft / Meta / Apple / Google search pages
  let driver: WebDriver | null = null;
  const seenLinks = new Set<string>();
  try {
    appendTaskLog('Opening Orange Chrome for FAANG career portals…');
    driver = await attachDriver(orangeProfile());
    for (const portal of FAANG_PRIORITY_PORTALS) {
      if (portal.apiKind === 'amazon') continue;
      if (shouldAbortScrape() || savedIds.length >= target) break;

      const searchUrls = [portal.searchUrl, ...(portal.extraSearchUrls || [])];
      for (const searchUrl of searchUrls) {
        if (shouldAbortScrape() || savedIds.length >= target) break;

        logScrapingUrl(searchUrl, `${portal.name} search`);
        console.log(`\n--- ${portal.name}: ${searchUrl} ---`);
        try {
          await driver.get(searchUrl);
          await scrapeSleep(3500);
          // Scroll listing pages so lazy-loaded cards appear
          try {
            await driver.executeScript(`
              window.scrollTo(0, document.body.scrollHeight * 0.6);
            `);
            await scrapeSleep(1200);
          } catch {
            // ignore
          }
          const links = await harvestJobLinks(driver, portal.name);
          const fresh = links.filter((link) => {
            const key = link.split('?')[0].replace(/\/$/, '').toLowerCase();
            if (seenLinks.has(key)) return false;
            seenLinks.add(key);
            return true;
          });
          appendTaskLog(
            `  ${portal.name}: ${fresh.length} new link(s)` +
              (links.length !== fresh.length ? ` (${links.length - fresh.length} dup skipped)` : '')
          );
          console.log(
            `  Found ${links.length} link(s), ${fresh.length} new after in-run dedupe`
          );

          for (const link of fresh.slice(0, 30)) {
            if (shouldAbortScrape() || savedIds.length >= target) break;
            try {
              logScrapingUrl(link, portal.name);
              await driver.get(link);
              await scrapeSleep(1500);
              const job = await readJobPage(driver, portal.name);
              if (!job) continue;
              // Skip pure program pages without a real job title
              if (!/\bintern|co-?op|software|engineer|developer|sde\b/i.test(job.title)) continue;
              await savePortalJobs([job], savedIds, target, 'company_portal');
            } catch (err) {
              console.warn(`  Skip link ${link}:`, err instanceof Error ? err.message : err);
              appendTaskLog(`  ↳ Skip ${link.slice(0, 80)}…`);
            }
          }
        } catch (err) {
          console.error(`FAANG portal ${portal.name} failed:`, err instanceof Error ? err.message : err);
          appendTaskLog(`${portal.name} portal scrape failed — continuing.`);
        }
      }
    }
  } finally {
    await releaseDriver(driver);
  }

  const added = savedIds.length - existingIds.length;
  appendTaskLog(`FAANG portals: ${added} new job(s).`);
  return savedIds.slice(existingIds.length);
}
