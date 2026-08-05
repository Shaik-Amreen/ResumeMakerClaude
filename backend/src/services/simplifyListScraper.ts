import { SIMPLIFY_NEW_GRAD_LISTS, type SimplifyJobListTarget } from '../data/faangPriorityPortals';
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

/**
 * Public scoped Typesense key embedded in simplify.jobs frontend (search-only).
 * Same key the Top-New-Grad InstantSearch client uses.
 */
const SIMPLIFY_TYPESENSE_API_KEY =
  'SWF1ODFZbzBkcVlVdnVwT2FqUE5EZ3JpSk5hVmdpUHg1SklXWEdGbHZVRT1POHJieyJleGNsdWRlX2ZpZWxkcyI6ImNvbXBhbnlfdXJsLGNhdGVnb3JpZXMsYWRkaXRpb25hbF9yZXF1aXJlbWVudHMsY291bnRyaWVzLGRlZ3JlZXMsZ2VvbG9jYXRpb25zLGluZHVzdHJpZXMsaXNfc2ltcGxlX2FwcGxpY2F0aW9uLGpvYl9saXN0cyxsZWFkZXJzaGlwX3R5cGUsc2VjdXJpdHlfY2xlYXJhbmNlLHNraWxscyx1cmwifQ==';

const TYPESENSE_HOSTS = ['js1.simplify.jobs', 'js2.simplify.jobs', 'js-ha.simplify.jobs'];

interface SimplifyHit {
  id: string;
  title: string;
  company_name: string;
  locations?: string[];
  functions?: string[];
  experience_level?: string[];
  type?: string;
  sponsors_h1b?: boolean;
  updated_date?: number;
}

interface SimplifyJobDetail {
  id: string;
  title: string;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  locations?: Array<{ value?: string; country?: string }>;
  url?: string;
  sponsors_h1b?: boolean | null;
  active?: boolean;
  job?: { company?: { name?: string } };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function typesenseSearch(filterBy: string, page: number, perPage: number): Promise<{
  found: number;
  hits: SimplifyHit[];
}> {
  const body = {
    searches: [
      {
        collection: 'jobs',
        q: 'software engineer',
        query_by: 'title,company_name,locations',
        filter_by: filterBy,
        per_page: perPage,
        page,
        sort_by: 'updated_date:desc',
      },
    ],
  };

  let lastErr: unknown;
  for (const host of TYPESENSE_HOSTS) {
    try {
      const res = await fetch(`https://${host}/multi_search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TYPESENSE-API-KEY': SIMPLIFY_TYPESENSE_API_KEY,
          Origin: 'https://simplify.jobs',
          Referer: 'https://simplify.jobs/l/Top-New-Grad',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        lastErr = new Error(`Typesense ${host} HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as {
        results?: Array<{ found?: number; hits?: Array<{ document?: SimplifyHit }>; error?: string }>;
      };
      const result = data.results?.[0];
      if (result?.error) {
        lastErr = new Error(result.error);
        continue;
      }
      const hits = (result?.hits || [])
        .map((h) => h.document)
        .filter((d): d is SimplifyHit => Boolean(d?.id && d?.title));
      return { found: result?.found || 0, hits };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Typesense search failed'));
}

async function fetchJobDetail(jobId: string): Promise<SimplifyJobDetail | null> {
  try {
    const res = await fetch(`https://api.simplify.jobs/v2/job-posting/:id/${jobId}/company`, {
      headers: {
        Accept: 'application/json',
        Origin: 'https://simplify.jobs',
        Referer: `https://simplify.jobs/p/${jobId}`,
        'User-Agent': 'Mozilla/5.0 (job-tracker)',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as SimplifyJobDetail;
  } catch {
    return null;
  }
}

async function resolveApplyUrl(jobId: string, fallbackClickUrl?: string): Promise<string> {
  const click = fallbackClickUrl || `https://simplify.jobs/jobs/click/${jobId}`;
  try {
    const res = await fetch(click, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (job-tracker)', Referer: 'https://simplify.jobs/' },
    });
    const finalUrl = res.url || click;
    if (/simplify\.jobs\/(jobs\/click|p\/)/i.test(finalUrl)) return click;
    return finalUrl;
  } catch {
    return click;
  }
}

function buildDescription(detail: SimplifyJobDetail, hit: SimplifyHit): string {
  const requirements = detail.requirements || [];
  const responsibilities = detail.responsibilities || [];
  const parts = [
    stripHtml(detail.description || ''),
    requirements.length
      ? `Requirements:\n${requirements.map((r) => `- ${stripHtml(r)}`).join('\n')}`
      : '',
    responsibilities.length
      ? `Responsibilities:\n${responsibilities.map((r) => `- ${stripHtml(r)}`).join('\n')}`
      : '',
    hit.functions?.length ? `Functions: ${hit.functions.join(', ')}` : '',
    hit.experience_level?.length ? `Experience: ${hit.experience_level.join(', ')}` : '',
  ].filter(Boolean);
  return cleanJobDescriptionForResume(parts.join('\n\n'));
}

function listFilter(list: SimplifyJobListTarget): string {
  const listClause = `job_lists:=\`${list.listId}\``;
  const fns = list.functionFilters || [];
  if (!fns.length) return listClause;
  // Typesense OR across functions
  const fnClause = fns.map((f) => `functions:=\`${f}\``).join(' || ');
  return `${listClause} && (${fnClause})`;
}

/**
 * Scrape Simplify curated new-grad lists (e.g. Top-New-Grad) via public Typesense + job detail API.
 */
export async function scrapeSimplifyNewGradLists(
  existingIds: string[] = [],
  jobType: JobType = 'fulltime'
): Promise<string[]> {
  const savedIds = [...existingIds];
  const target = scrapeRunTarget();
  const source: ScrapeSource = 'simplify';
  const modeLabel = jobType === 'fulltime' ? 'new-grad / full-time' : 'internship';

  appendTaskLog(`Simplify lists — ${modeLabel} (up to ${target} new)…`);
  console.log(`\n✨ Simplify curated lists — ${modeLabel} — target ${target}`);

  for (const list of SIMPLIFY_NEW_GRAD_LISTS) {
    if (shouldAbortScrape() || savedIds.length - existingIds.length >= target) break;

    logScrapingUrl(list.pageUrl, list.name);
    appendTaskLog(`  ${list.name}: ${list.pageUrl}`);
    console.log(`\n--- ${list.name} ---`);

    const filterBy = listFilter(list);
    let page = 1;
    const perPage = 30;
    let found = 0;

    while (!shouldAbortScrape() && savedIds.length - existingIds.length < target) {
      let batch: SimplifyHit[] = [];
      try {
        const result = await typesenseSearch(filterBy, page, perPage);
        found = result.found;
        batch = result.hits;
        if (page === 1) {
          appendTaskLog(`  ${list.name}: ${found} SWE-ish listing(s) in Typesense`);
          console.log(`  Typesense found ${found}`);
        }
      } catch (err) {
        console.error(`Simplify Typesense failed (${list.name}):`, err instanceof Error ? err.message : err);
        appendTaskLog(`  Typesense failed for ${list.name} — skipping list.`);
        break;
      }

      if (!batch.length) break;

      for (const hit of batch) {
        if (shouldAbortScrape() || savedIds.length - existingIds.length >= target) break;

        const title = (hit.title || '').trim();
        const company = (hit.company_name || '').trim();
        if (!title || !company) continue;
        if (!isSoftwareRole(title, title)) continue;

        const locationHint = (hit.locations || []).join(', ') || 'United States';
        // Citizenship / sponsorship heuristics before spending a detail fetch
        if (await isDuplicateJob(`https://simplify.jobs/p/${hit.id}`, title, company)) continue;

        console.log(`  ↪ Detail: ${title} @ ${company}`);
        const detail = await fetchJobDetail(hit.id);
        await scrapeSleep(200);
        if (!detail || detail.active === false) {
          console.log(`  ↳ Skipped — inactive / no detail`);
          continue;
        }

        const description = buildDescription(detail, hit);
        if (!description || description.length < 200) {
          console.log(`  ↳ Skipped — thin JD`);
          continue;
        }

        const loc =
          (detail.locations || []).map((l) => l.value).filter(Boolean).join(', ') || locationHint;

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
          console.log(`  ↳ Skipped — not eligible for ${modeLabel}`);
          continue;
        }

        const applyUrl = await resolveApplyUrl(hit.id, detail.url);
        logScrapingUrl(applyUrl, `${title} @ ${company}`);

        const id = await saveJobIfNew({
          title,
          company: detail.job?.company?.name || company,
          url: applyUrl,
          jobDescription: description,
          location: loc || 'United States',
          posted: hit.updated_date
            ? new Date(hit.updated_date * 1000).toISOString().slice(0, 10)
            : undefined,
          source,
          forcedType: jobType,
          priority: isFaangMangoCompany(company) ? 'faang' : 'standard',
          pipelinePhase: 'career_portal',
        });

        if (!id) continue;
        savedIds.push(id);
        incrementScraped();
        setTaskProgress(savedIds.length - existingIds.length, target, `${company} — ${title}`);
        console.log(`  ↳ [Simplify] Saved: ${title} @ ${company}`);
      }

      if (batch.length < perPage) break;
      page += 1;
      // Soft cap pages so we don't crawl thousands in one run
      if (page > 15) break;
    }
  }

  const added = savedIds.length - existingIds.length;
  appendTaskLog(`Simplify lists: ${added} new job(s).`);
  return savedIds.slice(existingIds.length);
}
