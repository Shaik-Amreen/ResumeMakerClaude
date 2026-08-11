import { config } from '../config';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import type { JobType } from '../models/Job';
import { scrapeRunTarget } from '../utils/scrapeLimits';
import { isEligibleJob, isSoftwareRole } from './eligibility';
import { isDuplicateJob } from './jobDedup';
import { shouldSkipJobDescription } from './jobSkipRules';
import { saveJobIfNew, type ScrapeSource } from './scrapeUtils';
import { shouldAbortScrape, scrapeSleep } from './scrapeContext';
import { appendTaskLog, incrementScraped, logScrapingUrl, setTaskProgress } from './taskStatusService';
import { isUsJobLocation } from './usLocation';
import { cleanJobDescriptionForResume } from './cleanJobDescription';

const API_BASE = 'https://api.scoutify.com';
const APP_ORIGIN = 'https://app.scoutify.com';

/** United States country place id from Scoutify places API. */
const US_PLACE_ID = 241;

/**
 * Engineering / SWE-adjacent category slugs from Scoutify's custom_category attribute.
 * Mirrors selecting "Engineering" (+ related) on https://app.scoutify.com/
 */
const DEFAULT_CATEGORIES = [
  'software_engineer',
  'frontend_engineer',
  'mobile_engineer',
  'data_engineer',
  'devops_engineer',
  'machine_learning_engineer',
  'ai_llm_engineer',
  'ai_ml_research',
  'cybersecurity_engineer',
  'security_engineer',
  'qa_engineer',
  'data_scientist',
  'data_analyst',
  'quant_developer',
  'quant_research',
  'embedded_firmware_engineer',
  'forward_deployed_engineer',
  'deployment_engineer',
  'solutions_architect',
];

interface ScoutifyCompany {
  id: number;
  name: string;
  slug?: string;
}

interface ScoutifyFeedJob {
  id: number;
  title: string;
  url: string;
  is_active?: boolean;
  posted_at?: string | null;
  created_at?: string;
  display_at?: string;
  company: ScoutifyCompany;
  location_display?: string | null;
  attributes?: Array<{ type?: string; value?: string }>;
}

interface ScoutifyFeedResponse {
  jobs: ScoutifyFeedJob[];
  total?: number | null;
  has_more: boolean;
  next_cursor?: string | null;
}

interface ScoutifyJobDetail extends ScoutifyFeedJob {
  description?: string | null;
  description_html?: string | null;
}

function headers(): Record<string, string> {
  return {
    Accept: 'application/json',
    Origin: APP_ORIGIN,
    Referer: `${APP_ORIGIN}/`,
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
}

function categories(): string[] {
  return config.scoutify.categories.length ? config.scoutify.categories : DEFAULT_CATEGORIES;
}

function buildFeedUrl(cursor?: string | null): string {
  const url = new URL(`${API_BASE}/api/browse/feed`);
  url.searchParams.set('categories', categories().join(','));
  url.searchParams.set('place_ids', String(config.scoutify.placeId || US_PLACE_ID));
  url.searchParams.set('job_types', 'full_time');
  url.searchParams.set('max_yoe', String(config.scoutify.maxYoe));
  url.searchParams.set('limit', String(Math.min(50, Math.max(10, config.scoutify.pageSize))));
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

async function fetchFeed(cursor?: string | null): Promise<ScoutifyFeedResponse> {
  const res = await fetch(buildFeedUrl(cursor), { headers: headers() });
  if (!res.ok) {
    throw new Error(`Scoutify feed HTTP ${res.status}`);
  }
  return (await res.json()) as ScoutifyFeedResponse;
}

async function fetchJobDetail(jobId: number): Promise<ScoutifyJobDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/api/browse/jobs/${jobId}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as ScoutifyJobDetail;
  } catch {
    return null;
  }
}

function isFullTimeListing(job: ScoutifyFeedJob): boolean {
  const attrs = job.attributes || [];
  const jobTypes = attrs.filter((a) => a.type === 'job_type' || a.type === 'employment_type').map((a) => a.value || '');
  if (jobTypes.some((v) => /intern/i.test(v))) return false;
  if (jobTypes.some((v) => v === 'full_time')) return true;
  // Some listings omit job_type; keep and let saveJobIfNew / eligibility decide.
  return jobTypes.length === 0 || !jobTypes.every((v) => /contract|part_time|temporary/i.test(v));
}

/**
 * Scrape latest US SWE / new-grad-ish roles from Scoutify's public browse feed
 * (https://app.scoutify.com/), then hydrate JDs via /api/browse/jobs/{id}.
 * Shared eligibility / skip / AI filters apply in saveJobIfNew.
 */
export async function scrapeScoutifyJobs(
  existingIds: string[] = [],
  _requestedType: JobType = 'fulltime'
): Promise<string[]> {
  const jobType: JobType = 'fulltime';
  const savedIds = [...existingIds];
  const target = scrapeRunTarget();
  const source: ScrapeSource = 'scoutify';
  const modeLabel = 'full-time / US / eng / max YOE';

  appendTaskLog(`Scoutify — ${modeLabel} (up to ${target} new)…`);
  console.log(`\n🔎 Scoutify browse feed — ${modeLabel} — target ${target}`);
  logScrapingUrl(APP_ORIGIN, 'Scoutify dashboard');

  let cursor: string | null | undefined = null;
  let page = 0;
  let totalHint: number | null = null;
  const maxPages = Math.max(1, config.scoutify.maxPages);

  while (!shouldAbortScrape() && savedIds.length - existingIds.length < target && page < maxPages) {
    page += 1;
    let feed: ScoutifyFeedResponse;
    try {
      feed = await fetchFeed(cursor);
    } catch (err) {
      console.error('Scoutify feed failed:', err instanceof Error ? err.message : err);
      appendTaskLog(`  Scoutify feed failed: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }

    if (page === 1) {
      totalHint = typeof feed.total === 'number' ? feed.total : null;
      appendTaskLog(
        `  Scoutify matched ~${totalHint ?? '?'} listing(s) (US eng, full-time, max ${config.scoutify.maxYoe} YOE)`
      );
      console.log(`  Feed total≈${totalHint ?? '?'}, first page ${feed.jobs?.length || 0}`);
    }

    const batch = feed.jobs || [];
    if (!batch.length) break;

    for (const hit of batch) {
      if (shouldAbortScrape() || savedIds.length - existingIds.length >= target) break;

      const title = (hit.title || '').trim();
      const company = (hit.company?.name || '').trim();
      const applyUrl = (hit.url || '').trim();
      if (!title || !company || !applyUrl) continue;
      if (!isFullTimeListing(hit)) continue;
      if (!isSoftwareRole(title, title)) continue;

      const locationHint = (hit.location_display || '').trim() || 'United States';
      if (await isDuplicateJob(applyUrl, title, company)) continue;

      console.log(`  ↪ Detail: ${title} @ ${company}`);
      const detail = await fetchJobDetail(hit.id);
      await scrapeSleep(150);
      if (!detail || detail.is_active === false) {
        console.log(`  ↳ Skipped — inactive / no detail`);
        continue;
      }

      const description = cleanJobDescriptionForResume(
        detail.description || detail.description_html || ''
      );
      if (!description || description.length < 200) {
        console.log(`  ↳ Skipped — thin JD`);
        continue;
      }

      const loc = (detail.location_display || locationHint || 'United States').trim();
      if (!isUsJobLocation(loc, description)) {
        console.log(`  ↳ Skipped — not a U.S. location`);
        continue;
      }
      const skip = shouldSkipJobDescription(title, company, description);
      if (skip.skip) {
        console.log(`  ↳ Skipped — ${skip.reason}`);
        continue;
      }
      if (!isEligibleJob(jobType, title, description)) {
        console.log(`  ↳ Skipped — not eligible for full-time / new-grad`);
        continue;
      }

      logScrapingUrl(applyUrl, `${title} @ ${company}`);

      const postedRaw = detail.posted_at || detail.display_at || hit.posted_at || hit.display_at;
      const id = await saveJobIfNew({
        title,
        company: detail.company?.name || company,
        url: (detail.url || applyUrl).trim(),
        jobDescription: description,
        location: loc,
        posted: postedRaw ? String(postedRaw).slice(0, 10) : undefined,
        postedAt: postedRaw ? new Date(postedRaw) : undefined,
        source,
        forcedType: jobType,
        priority: isFaangMangoCompany(company) ? 'faang' : 'standard',
        pipelinePhase: 'career_portal',
      });

      if (!id) continue;
      savedIds.push(id);
      incrementScraped();
      setTaskProgress(savedIds.length - existingIds.length, target, `${company} — ${title}`);
      console.log(`  ↳ [Scoutify] Saved: ${title} @ ${company}`);
    }

    if (!feed.has_more || !feed.next_cursor) break;
    cursor = feed.next_cursor;
    await scrapeSleep(200);
  }

  const added = savedIds.length - existingIds.length;
  appendTaskLog(`Scoutify: ${added} new job(s).`);
  return savedIds.slice(existingIds.length);
}
