import { config } from '../config';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { saveJobIfNew, type ScrapeSource } from './scrapeUtils';
import { isDuplicateJob } from './jobDedup';
import { shouldAbortScrape } from './scrapeContext';
import { appendTaskLog, incrementScraped, setTaskProgress } from './taskStatusService';
import type { JobType } from '../models/Job';

/**
 * Direct ATS board scraping — no browser automation needed.
 * Greenhouse and Lever both expose free, public, unauthenticated JSON job-board APIs.
 * This is the "watch 50,000+ career pages" feature Tsenta charges for — free here,
 * limited to the boards configured in config.ats.greenhouseBoards / leverBoards.
 */

interface NormalizedAtsJob {
  title: string;
  company: string;
  url: string;
  jobDescription: string;
  location?: string;
  posted?: string;
  postedAt?: Date;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
  // Greenhouse content is sometimes double HTML-encoded, so decode twice before stripping tags.
  const decoded = decodeEntities(decodeEntities(html));
  return decoded
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (job-tracker)' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`ATS fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Greenhouse public job-board API: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true */
async function fetchGreenhouseBoard(slug: string, companyLabel: string): Promise<NormalizedAtsJob[]> {
  interface GHJob {
    id: number;
    title: string;
    absolute_url: string;
    content?: string;
    location?: { name?: string };
    updated_at?: string;
  }
  interface GHResponse {
    jobs: GHJob[];
  }

  const data = await fetchJson<GHResponse>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`
  );
  if (!data?.jobs?.length) return [];

  return data.jobs.map((job) => ({
    title: job.title?.trim() || '',
    company: companyLabel,
    url: job.absolute_url,
    jobDescription: stripHtml(job.content || ''),
    location: job.location?.name?.trim() || undefined,
    postedAt: job.updated_at ? new Date(job.updated_at) : undefined,
  }));
}

/** Lever public postings API: https://api.lever.co/v0/postings/{slug}?mode=json */
async function fetchLeverBoard(slug: string, companyLabel: string): Promise<NormalizedAtsJob[]> {
  interface LeverJob {
    id: string;
    text: string;
    hostedUrl: string;
    categories?: { location?: string; team?: string };
    descriptionPlain?: string;
    description?: string;
    lists?: { text: string; content: string }[];
    createdAt?: number;
  }

  const data = await fetchJson<LeverJob[]>(
    `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`
  );
  if (!data?.length) return [];

  return data.map((job) => {
    const extraLists = (job.lists || [])
      .map((l) => `${l.text}\n${stripHtml(l.content || '')}`)
      .join('\n\n');
    const description = [job.descriptionPlain || stripHtml(job.description || ''), extraLists]
      .filter(Boolean)
      .join('\n\n');

    return {
      title: job.text?.trim() || '',
      company: companyLabel,
      url: job.hostedUrl,
      jobDescription: description,
      location: job.categories?.location?.trim() || undefined,
      postedAt: job.createdAt ? new Date(job.createdAt) : undefined,
    };
  });
}

async function saveAtsJobs(
  jobs: NormalizedAtsJob[],
  source: ScrapeSource,
  jobType: JobType,
  savedIds: string[],
  target: number
): Promise<void> {
  for (const job of jobs) {
    if (shouldAbortScrape()) {
      appendTaskLog('ATS scrape stopped by user.');
      return;
    }
    if (savedIds.length >= target) return;
    if (!job.title || !job.company || !job.jobDescription || !job.url) continue;

    if (await isDuplicateJob(job.url, job.title, job.company)) continue;

    const id = await saveJobIfNew({
      title: job.title,
      company: job.company,
      url: job.url,
      jobDescription: job.jobDescription,
      location: job.location || 'United States',
      postedAt: job.postedAt,
      source,
      forcedType: jobType,
      priority: isFaangMangoCompany(job.company) ? 'faang' : 'standard',
      pipelinePhase: 'career_portal',
    });

    if (!id) continue;

    savedIds.push(id);
    incrementScraped();
    setTaskProgress(savedIds.length, target, `${job.company} — ${job.title}`);
    console.log(`  ↳ [ATS/${source}] Saved: ${job.title} @ ${job.company}`);
  }
}

/**
 * Scrape all configured Greenhouse + Lever boards directly (no Selenium, free public APIs).
 * This is the direct ATS-coverage equivalent of Tsenta's paid feature.
 */
export async function scrapeAtsBoards(jobType: JobType = 'internship'): Promise<string[]> {
  const savedIds: string[] = [];
  const target = config.pipeline.perSourceCap || 50;

  const { greenhouseBoards, leverBoards } = config.ats;

  console.log(`\n🏢 ATS direct scrape — ${greenhouseBoards.length} Greenhouse + ${leverBoards.length} Lever boards`);

  for (const board of greenhouseBoards) {
    if (shouldAbortScrape() || savedIds.length >= target) break;
    console.log(`  Greenhouse: ${board.company} (${board.slug})`);
    const jobs = await fetchGreenhouseBoard(board.slug, board.company);
    await saveAtsJobs(jobs, 'greenhouse', jobType, savedIds, target);
  }

  for (const board of leverBoards) {
    if (shouldAbortScrape() || savedIds.length >= target) break;
    console.log(`  Lever: ${board.company} (${board.slug})`);
    const jobs = await fetchLeverBoard(board.slug, board.company);
    await saveAtsJobs(jobs, 'lever', jobType, savedIds, target);
  }

  return savedIds;
}
