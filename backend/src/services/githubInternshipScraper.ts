import { GITHUB_INTERNSHIP_LISTS } from '../data/faangPriorityPortals';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { saveJobIfNew, type ScrapeSource } from './scrapeUtils';
import { isDuplicateJob } from './jobDedup';
import { shouldAbortScrape } from './scrapeContext';
import { appendTaskLog, incrementScraped, logScrapingUrl, setTaskProgress } from './taskStatusService';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { isSoftwareRole } from './eligibility';
import {
  fetchJobDescriptionFromApplyUrl,
  closeJdFetchSession,
  isPlaceholderGithubJd,
  type JdFetchSession,
} from './applyPageJdFetcher';
import { shouldSkipJobDescription } from './jobSkipRules';
import { isSummer2027InternTarget } from './jobMaintenance';
import { isUsJobLocation } from './usLocation';

interface GhRow {
  company: string;
  title: string;
  location: string;
  url: string;
  closed: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<br\s*\/?>/gi, ', ');
}

function extractHref(cell: string): string {
  const m = cell.match(/href=["']([^"']+)["']/i);
  return m ? m[1].trim() : '';
}

function cellText(cell: string): string {
  return decodeEntities(cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Parse markdown job tables from vansh / SpeedyApply-style READMEs. */
export function parseGithubInternshipTable(markdown: string): GhRow[] {
  const rows: GhRow[] = [];
  let lastCompany = '';

  for (const rawLine of markdown.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-+/.test(line) || /Company\s*\|\s*(Role|Position)/i.test(line)) continue;

    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;

    // SpeedyApply: Company | Position | Location | Salary | Posting | Age
    // Vansh: Company | Role | Location | Application/Link | Date Posted
    const companyCell = cells[0];
    const roleCell = cells[1];
    const locationCell = cells[2];
    const linkCell = cells.length >= 6 ? cells[4] : cells[3];

    let company = cellText(companyCell.replace(/↳/g, '').trim());
    if (!company || company === '↳') company = lastCompany;
    else lastCompany = company;
    if (!company) continue;

    const title = cellText(roleCell);
    if (!title || title.length < 3) continue;

    const closed = /🔒/.test(roleCell) || /🔒/.test(companyCell) || /closed/i.test(title);
    const location = cellText(locationCell) || 'United States';
    const url = extractHref(linkCell);
    if (!url || !/^https?:\/\//i.test(url)) continue;

    rows.push({ company, title, location, url, closed });
  }

  return rows;
}

function titleLooksProfileCompatible(title: string): boolean {
  // Hard title skips before fetching JD (saves time)
  if (/\bundergrad(?:uate)?\b/i.test(title) && !/\bmaster|grad(?:uate)?\b/i.test(title)) {
    return false;
  }
  if (/\bph\.?d\b/i.test(title) && !/\bmaster|m\.?s\b/i.test(title)) {
    return false;
  }
  if (/\bwinter\b/i.test(title) && /\bco-?op\b/i.test(title) && !/\bsummer\b/i.test(title)) {
    return false;
  }
  if (/\bfall\s*2026\b|\bspring\s*2026\b|\b2026\s+start\b/i.test(title)) {
    return false;
  }
  return true;
}

/**
 * Phase 2 — curated GitHub Summer 2027 SWE internship lists.
 * Always opens the apply URL for a real JD; only saves if it matches Amreen’s MS profile.
 */
export async function scrapeGithubInternshipLists(existingIds: string[] = []): Promise<string[]> {
  const savedIds = [...existingIds];
  const target = scrapeRunTarget();
  const source: ScrapeSource = 'github';

  appendTaskLog(`GitHub internship lists (up to ${target} new) — fetch real JD from apply links…`);
  console.log(`\n📦 GitHub Summer 2027 lists — target ${target} (real JD required)`);

  const session: JdFetchSession = { driver: null };

  try {
  for (const list of GITHUB_INTERNSHIP_LISTS) {
    if (shouldAbortScrape() || savedIds.length - existingIds.length >= target) break;
    logScrapingUrl(list.rawUrl, `GitHub list ${list.name}`);
    console.log(`\n--- ${list.name} ---`);

    let md = '';
    try {
      const res = await fetch(list.rawUrl, {
        headers: { Accept: 'text/plain', 'User-Agent': 'Mozilla/5.0 (job-tracker)' },
      });
      if (!res.ok) {
        console.error(`Failed to fetch ${list.rawUrl}: ${res.status}`);
        appendTaskLog(`  Failed to fetch ${list.name}: HTTP ${res.status}`);
        continue;
      }
      md = await res.text();
    } catch (err) {
      console.error(`GitHub list fetch failed (${list.name}):`, err instanceof Error ? err.message : err);
      appendTaskLog(`  GitHub list fetch failed: ${list.name}`);
      continue;
    }

    const rows = parseGithubInternshipTable(md);
    console.log(`  Parsed ${rows.length} row(s)`);
    appendTaskLog(`  ${list.name}: parsed ${rows.length} row(s)`);

    for (const row of rows) {
      if (shouldAbortScrape()) {
        appendTaskLog('GitHub list scrape stopped by user.');
        break;
      }
      if (savedIds.length - existingIds.length >= target) break;
      if (row.closed) continue;

      const title = row.title.replace(/[🛂🇺🇸🔒]/g, '').trim();
      const company = row.company.replace(/[🛂🇺🇸🔒]/g, '').trim();

      if (!titleLooksProfileCompatible(title)) {
        console.log(`  ↳ Skip title (profile): ${title} @ ${company}`);
        continue;
      }
      if (!isSoftwareRole(title, title)) continue;

      const loc = row.location.toLowerCase();
      if (
        loc &&
        /\bcanada\b|\btoronto\b|\bvancouver\b|\bmontreal\b/.test(loc) &&
        !/\busa\b|united states|remote|,\s*[A-Z]{2}\b/i.test(row.location)
      ) {
        continue;
      }

      if (await isDuplicateJob(row.url, title, company)) continue;

      console.log(`  ↪ Fetching JD: ${title} @ ${company}`);
      logScrapingUrl(row.url, `${title} @ ${company}`);
      const description = await fetchJobDescriptionFromApplyUrl(row.url, {
        allowSelenium: true,
        session,
      });

      if (!description || description.length < 200 || isPlaceholderGithubJd(description)) {
        console.log(`  ↳ Skipped — could not fetch real JD from ${row.url}`);
        appendTaskLog(`  ↳ No real JD (closed/not found): ${title} @ ${company}`);
        continue;
      }

      // Profile / eligibility gates (same as saveJobIfNew, but log clearly)
      if (!isUsJobLocation(row.location, description)) {
        console.log(`  ↳ Skipped — not a U.S. location`);
        continue;
      }
      const skip = shouldSkipJobDescription(title, company, description);
      if (skip.skip) {
        console.log(`  ↳ Skipped — ${skip.reason}`);
        continue;
      }
      if (!isSummer2027InternTarget(title, description)) {
        console.log(`  ↳ Skipped — not Summer 2027 SWE intern target`);
        continue;
      }

      const id = await saveJobIfNew({
        title,
        company,
        url: row.url,
        jobDescription: description,
        location: row.location || 'United States',
        source,
        forcedType: 'internship',
        priority: isFaangMangoCompany(company) ? 'faang' : 'standard',
        pipelinePhase: 'career_portal',
      });

      if (!id) {
        console.log(`  ↳ Skipped — saveJobIfNew rejected (duplicate / filters)`);
        continue;
      }
      savedIds.push(id);
      incrementScraped();
      setTaskProgress(savedIds.length - existingIds.length, target, `${company} — ${title}`);
      console.log(`  ↳ [GitHub] Saved with real JD (${description.length} chars): ${title} @ ${company}`);
    }
  }

  const added = savedIds.length - existingIds.length;
  appendTaskLog(`GitHub lists: ${added} new job(s) with real JDs.`);
  return savedIds.slice(existingIds.length);
  } finally {
    await closeJdFetchSession(session);
  }
}
