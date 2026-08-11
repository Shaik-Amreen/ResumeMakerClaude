import { config } from '../config';
import { enqueueResume, isResumeQueueIdle } from './resumeQueue';
import { runResumePipeline } from './resumePipeline';
import { scrapePriorityCareerPortals } from './careerPortalScraper';
import { scrapeJobrightJobs } from './jobrightScraper';
import { scrapeLinkedInJobs } from './linkedinScraper';
import { scrapeIndeedJobs } from './indeedScraper';
import { scrapeAtsBoards } from './atsScraper';
import { scrapeFaangPriorityPortals } from './faangPortalScraper';
import { scrapeGithubInternshipLists } from './githubInternshipScraper';
import { scrapeSimplifyNewGradLists } from './simplifyListScraper';
import { scrapeScoutifyJobs } from './scoutifyScraper';
import { refreshExistingJobs } from './jobRefresher';
import {
  deleteAllJobs,
  pruneNonSoftwareJobs,
  resetAllJobsToScraped,
  normalizeJobSourceFilter,
} from './jobMaintenance';
import { runClaudeOnlyPipeline } from './pipelineService';
import { shouldAbortScrape, withScrapeRun } from './scrapeContext';
import { isPipelineAbortError, pipelineJobTimeoutMs } from './pipelineAbort';
import { generateOutreachArtifacts } from './outreachService';
import { autoApplyToJob, isLinkedInEasyApplyUrl } from './jobApplier';
import {
  abortTask,
  appendTaskLog,
  clearStopRequest,
  finishTask,
  getTaskStatus,
  isTaskActive,
  requestTaskStop,
  setResumeProgress,
  setTaskError,
  setTaskPhase,
  setTaskProgress,
  startTask,
} from './taskStatusService';
import Job from '../models/Job';
import { noteManualActivity } from './schedulerService';
import { makeTraceId, traceError, traceLog } from './debugTrace';

/** Serial queue lives in resumeQueue.ts */
let resumeChain: Promise<void> = Promise.resolve();

/** Resume generations this old are usually from a crashed/abandoned process. */
const STALE_RESUME_GENERATING_MS = 5 * 60 * 1000;
let scrapeRunning = false;
let pipelineRunning = false;
let resumeBatchRunning = false;
let resumePreparationRunning = false;

export function isScrapeRunning(): boolean {
  return (
    scrapeRunning ||
    pipelineRunning ||
    resumeBatchRunning ||
    resumePreparationRunning ||
    !isResumeQueueIdle() ||
    isTaskActive()
  );
}

/** Batch resume / scrape / pipeline / active task — excludes per-job enqueue idle check. */
export function isBulkTaskRunning(): boolean {
  return (
    scrapeRunning ||
    pipelineRunning ||
    resumeBatchRunning ||
    resumePreparationRunning ||
    isTaskActive()
  );
}

export function isPipelineRunning(): boolean {
  return pipelineRunning;
}

export { getTaskStatus, requestTaskStop };

function scrapeRunOpts(cap: number) {
  return {
    phaseCap: cap,
    skipAutoResume: true,
  };
}

export async function runResumePipelineQueue(
  jobIds: string[],
  withOutreach = false,
  startIndex = 0
) {
  let failed = 0;
  const total = jobIds.length;
  const startBatch = Date.now();
  const batchTraceId = makeTraceId('batch');
  traceLog(batchTraceId, 'batch.start', { total, startIndex, withOutreach });

  for (let i = startIndex; i < total; i++) {
    if (shouldAbortScrape()) {
      appendTaskLog(`Resume queue stopped at ${i}/${total}`);
      traceLog(batchTraceId, 'batch.stop-requested', { index: i, total });
      break;
    }
    setResumeProgress(i + 1, total);
    const job = await Job.findById(jobIds[i]);
    const jobTitle = job ? `${job.title} @ ${job.company}` : `Job ${i + 1}`;
    const traceId = `${batchTraceId}-job-${i + 1}`;
    appendTaskLog(`📄 Resume ${i + 1}/${total}: ${jobTitle}…`);
    traceLog(traceId, 'batch.job.start', {
      batchTraceId,
      index: i + 1,
      total,
      jobId: jobIds[i],
      title: job?.title,
      company: job?.company,
      previousStatus: job?.status,
      previousResumePhase: job?.resumePhase,
    });
    try {
      const jobAbort = new AbortController();
      const jobTimeoutMs = pipelineJobTimeoutMs();
      let stopPoll: ReturnType<typeof setInterval> | undefined;
      let jobTimer: ReturnType<typeof setTimeout> | undefined;

      stopPoll = setInterval(() => {
        if (shouldAbortScrape()) {
          jobAbort.abort('Stop requested by user');
        }
      }, 500);

      jobTimer = setTimeout(() => {
        jobAbort.abort(`Job resume generation timed out after ${Math.round(jobTimeoutMs / 60000)}m`);
      }, jobTimeoutMs);

      try {
        await runResumePipeline(jobIds[i], traceId, { signal: jobAbort.signal });
      } finally {
        if (stopPoll) clearInterval(stopPoll);
        if (jobTimer) clearTimeout(jobTimer);
      }
      traceLog(traceId, 'batch.job.done', { index: i + 1, total });
    } catch (err) {
      if (isPipelineAbortError(err)) {
        const msg = err.message;
        const isUserStop = msg.includes('Stop requested');
        if (isUserStop) {
          appendTaskLog(`⏹ Resume ${i + 1}/${total} cancelled — ${msg}`);
          traceLog(traceId, 'batch.job.cancelled', { index: i + 1, total, reason: msg });
          appendTaskLog(`Resume queue stopped at ${i + 1}/${total}`);
          traceLog(batchTraceId, 'batch.stop-requested', { index: i + 1, total });
          break;
        } else {
          failed += 1;
          console.error(`Resume ${i + 1}/${total} failed:`, err);
          appendTaskLog(`❌ Resume ${i + 1}/${total} failed: ${msg.slice(0, 180)}`);
          traceError(traceId, 'batch.job.failed', err, { index: i + 1, total });
        }
        continue;
      }
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Resume ${i + 1}/${total} failed:`, err);
      appendTaskLog(`❌ Resume ${i + 1}/${total} failed: ${msg.slice(0, 180)}`);
      traceError(traceId, 'batch.job.failed', err, { index: i + 1, total });
      continue;
    }
    if (withOutreach) {
      try {
        traceLog(traceId, 'batch.outreach.start');
        await generateOutreachArtifacts(jobIds[i]);
        traceLog(traceId, 'batch.outreach.done');
      } catch (err) {
        console.error(`Outreach failed for ${jobIds[i]}:`, err);
        traceError(traceId, 'batch.outreach.failed', err);
      }
    }
  }
  const totalSec = Math.round((Date.now() - startBatch) / 1000);
  const totalTimeStr = totalSec >= 60 ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s` : `${totalSec}s`;
  if (failed > 0) {
    appendTaskLog(`Batch finished with ${failed} failure(s) out of ${total} resumes in ${totalTimeStr}.`);
  } else {
    appendTaskLog(`Batch complete: ${total} resume(s) generated in ${totalTimeStr}.`);
  }
  traceLog(batchTraceId, 'batch.finish', { total, failed, totalTime: totalTimeStr });
}

/**
 * Jobs eligible for the "Generate resumes" batch:
 * - scraped (never attempted)
 * - failed (any resumePhase) — prior hard failures
 * - resume_generated + resumePhase failed — e.g. 2-page PDF after auto-repair
 * Does not pick active in-flight resume_generating, approval-ready PDFs, or applied.
 * Optional `source` limits to one scrape platform (e.g. scoutify).
 */
export function resumeQueueJobFilter(source?: string | null): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    jobType: 'fulltime',
    $or: [
      { status: 'scraped' },
      { status: 'failed' },
      { status: 'resume_generated', resumePhase: 'failed' },
    ],
  };
  const normalized = normalizeJobSourceFilter(source);
  if (normalized) filter.source = normalized;
  return filter;
}

async function recoverStaleResumeGeneratingJobs(source?: string | null): Promise<number> {
  const staleCutoff = new Date(Date.now() - STALE_RESUME_GENERATING_MS);
  const filter: Record<string, unknown> = {
    jobType: 'fulltime',
    status: 'resume_generating',
    updatedAt: { $lt: staleCutoff },
  };
  const normalized = normalizeJobSourceFilter(source);
  if (normalized) filter.source = normalized;
  const result = await Job.updateMany(filter, {
    $set: {
      status: 'failed',
      resumePhase: 'failed',
      pendingAction: null,
      errorMessage: 'Resume generation was abandoned or server restarted before completion.',
      approvalNote: 'Stale resume generation reset. It will be retried by batch generation.',
    },
  });
  const modified = result.modifiedCount || 0;
  if (modified > 0) {
    appendTaskLog(`Reset ${modified} stale resume generation(s) for retry.`);
    traceLog('resume-recovery', 'stale-reset', { modified, source: normalized || 'all' });
  }
  return modified;
}

/** Generate resumes one-by-one for scraped jobs and failed resume retries. */
export async function runResumesForScrapedJobs(options?: {
  limit?: number;
  withOutreach?: boolean;
  source?: string;
}) {
  if (scrapeRunning || pipelineRunning || resumeBatchRunning) {
    throw new Error('Another scrape, pipeline, or resume batch is already running.');
  }
  resumeBatchRunning = true;
  clearStopRequest();
  const source = normalizeJobSourceFilter(options?.source);
  const sourceLabel = source ? ` (${source})` : '';
  startTask('generating_resumes', `Preparing the sequential resume queue${sourceLabel}…`);
  const traceId = makeTraceId('batch-start');
  traceLog(traceId, 'runResumesForScrapedJobs.start', {
    limit: options?.limit,
    withOutreach: options?.withOutreach,
    source: source || 'all',
  });

  const limit = options?.limit && options.limit > 0 ? options.limit : 0;
  try {
    await recoverStaleResumeGeneratingJobs(source);
    // Newest first so recent scrapes (usually cleaner JDs) run before old leftovers.
    // Prefer jobs that actually have a JD body — empty JD wastes the whole batch slot.
    const query = Job.find({
      ...resumeQueueJobFilter(source),
      jobDescription: { $exists: true, $type: 'string', $ne: '' },
    }).sort({ createdAt: -1 });
    let jobs = limit ? await query.limit(Math.max(limit * 3, limit)).exec() : await query.exec();
    jobs = jobs.filter((j) => String(j.jobDescription || '').trim().length >= 80);
    if (limit > 0) jobs = jobs.slice(0, limit);
    const jobIds = jobs.map((j) => j.id);
    traceLog(traceId, 'runResumesForScrapedJobs.selected', { count: jobIds.length, source: source || 'all' });

    if (!jobIds.length) {
      finishTask(
        source
          ? `No ${source} jobs waiting for resume generation.`
          : 'No scraped or failed jobs waiting for resume generation.'
      );
      traceLog(traceId, 'runResumesForScrapedJobs.none');
      return { count: 0 };
    }

    setTaskPhase(
      'resumes',
      `Generating ${jobIds.length} resume(s)${sourceLabel} (scraped + failed retries, one by one)…`
    );
    await runResumePipelineQueue(jobIds, options?.withOutreach ?? false);
    if (shouldAbortScrape()) {
      abortTask(`Stopped — processed ${jobIds.length} resume slot(s) before stop.`);
      traceLog(traceId, 'runResumesForScrapedJobs.aborted');
    } else {
      finishTask(`Resume queue complete — ${jobIds.length} job(s) processed${sourceLabel}.`);
      traceLog(traceId, 'runResumesForScrapedJobs.finished', { count: jobIds.length });
    }
    return { count: jobIds.length };
  } catch (err) {
    setTaskError(err);
    abortTask('Resume generation failed.');
    traceError(traceId, 'runResumesForScrapedJobs.failed', err);
    throw err;
  } finally {
    resumeBatchRunning = false;
    clearStopRequest();
    traceLog(traceId, 'runResumesForScrapedJobs.finally');
  }
}

export async function prepareAndGenerateResumes() {
  if (scrapeRunning || pipelineRunning || resumeBatchRunning || resumePreparationRunning) {
    throw new Error('Another scrape, pipeline, or resume batch is already running.');
  }
  resumePreparationRunning = true;
  clearStopRequest();
  startTask('generating_resumes', 'Preparing jobs and removing old resume files…', 'prepare');

  try {
    const removed = await pruneNonSoftwareJobs();
    const reset = await resetAllJobsToScraped();
    const remaining = await Job.countDocuments();
    appendTaskLog(`Removed ${removed} non-software jobs. Reset ${reset}. ${remaining} remain.`);
  } catch (err) {
    setTaskError(err);
    abortTask('Preparing the resume batch failed.');
    throw err;
  } finally {
    resumePreparationRunning = false;
  }

  // Acquire the resume-batch reservation synchronously after releasing the
  // preparation reservation, so no second request can overlap this handoff.
  return runResumesForScrapedJobs();
}

export interface ScrapeResult {
  scraped: number;
  jobIds: string[];
  source: string;
}

async function runSingleSourceScrape(
  task:
    | 'scraping_jobright'
    | 'scraping_linkedin'
    | 'scraping_indeed'
    | 'scraping_career_portals'
    | 'scraping_faang_portals'
    | 'scraping_github_lists'
    | 'scraping_ats'
    | 'scraping_scoutify',
  label: string,
  cap: number,
  fn: () => Promise<string[]>
): Promise<ScrapeResult> {
  if (scrapeRunning || pipelineRunning) {
    throw new Error('Scrape or pipeline already running.');
  }

  scrapeRunning = true;
  clearStopRequest();
  noteManualActivity();
  startTask(task, `${label} — up to ${cap} new jobs`);

  try {
    let jobIds: string[] = [];
    await withScrapeRun(scrapeRunOpts(cap), async () => {
      jobIds = await fn();
    });

    const msg = shouldAbortScrape()
      ? `${label} stopped — ${jobIds.length} new job(s) saved.`
      : `${label} complete — ${jobIds.length} new job(s).`;

    if (!isTaskActive()) {
      // Already force-stopped from UI
    } else if (shouldAbortScrape()) abortTask(msg);
    else finishTask(msg);

    return { scraped: jobIds.length, jobIds, source: task.replace('scraping_', '') };
  } catch (err) {
    setTaskError(err);
    abortTask(`${label} failed.`);
    throw err;
  } finally {
    scrapeRunning = false;
    clearStopRequest();
    noteManualActivity();
  }
}

export function runScrapeJobright(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_jobright', 'Jobright', limit, () =>
    scrapeJobrightJobs([], jobType)
  );
}

export function runScrapeLinkedIn(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_linkedin', 'LinkedIn', limit, () =>
    scrapeLinkedInJobs([], jobType)
  );
}

export function runScrapeCareerPortals(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_career_portals', 'Google Jobs', limit, () =>
    scrapePriorityCareerPortals(jobType)
  );
}

export function runScrapeFaangPortals(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_faang_portals', 'FAANG portals', limit, () =>
    scrapeFaangPriorityPortals([], jobType)
  );
}

export function runScrapeGithubLists(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_github_lists', 'GitHub + Simplify lists', limit, async () => {
    const fromGithub = await scrapeGithubInternshipLists([], jobType);
    if (shouldAbortScrape()) return fromGithub;
    const fromSimplify = await scrapeSimplifyNewGradLists([], jobType);
    return [...fromGithub, ...fromSimplify];
  });
}

export function runScrapeIndeed(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_indeed', 'Indeed', limit, () =>
    scrapeIndeedJobs([], jobType)
  );
}

/** Direct ATS boards (Greenhouse + Lever public JSON APIs) — free, no browser automation. */
export function runScrapeAts(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_ats', 'ATS boards (Greenhouse/Lever)', limit, () =>
    scrapeAtsBoards(jobType)
  );
}

/** Scoutify public browse feed — latest US eng roles, no browser. */
export function runScrapeScoutify(cap?: number, jobType: 'internship' | 'fulltime' = 'fulltime') {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_scoutify', 'Scoutify', limit, () =>
    scrapeScoutifyJobs([], jobType)
  );
}

export interface MasterPipelineResult {
  deleted: number;
  faangPortals: number;
  githubLists: number;
  scoutify: number;
  jobright: number;
  linkedin: number;
  careerPortals: number;
  ats: number;
  total: number;
}

export async function runMasterPipeline(options?: {
  deleteFirst?: boolean;
  /** Total new jobs across ALL scrape sources combined (not per source). */
  perSourceCap?: number;
  jobType?: 'internship' | 'fulltime';
}): Promise<MasterPipelineResult> {
  if (pipelineRunning || scrapeRunning) {
    throw new Error('Pipeline or scrape already running.');
  }

  pipelineRunning = true;
  clearStopRequest();
  const totalCap = options?.perSourceCap ?? config.pipeline.perSourceCap;
  const jobType = 'fulltime' as const;
  let deleted = 0;
  let remaining = totalCap;

  startTask(
    'master_pipeline',
    `Master pipeline started — full-time / new-grad (max ${totalCap} jobs total)`,
    'init'
  );

  try {
    if (options?.deleteFirst === true) {
      setTaskPhase('delete', 'Deleting all existing jobs…');
      const result = await deleteAllJobs();
      deleted = result.deleted;
      appendTaskLog(`Deleted ${deleted} job(s).`);
    }

    const empty = {
      deleted,
      faangPortals: 0,
      githubLists: 0,
      scoutify: 0,
      jobright: 0,
      linkedin: 0,
      careerPortals: 0,
      ats: 0,
      total: 0,
    };

    if (shouldAbortScrape()) {
      abortTask('Pipeline stopped before scraping.');
      return empty;
    }

    const runPhase = async (
      phase: string,
      label: string,
      scrape: () => Promise<string[]>
    ): Promise<string[]> => {
      if (shouldAbortScrape() || remaining <= 0) return [];
      let ids: string[] = [];
      await withScrapeRun(scrapeRunOpts(remaining), async () => {
        setTaskPhase(phase, `${label} (${remaining} slot${remaining === 1 ? '' : 's'} left of ${totalCap})`);
        ids = await scrape();
      });
      remaining = Math.max(0, remaining - ids.length);
      appendTaskLog(`${label}: +${ids.length} (remaining slots: ${remaining})`);
      return ids;
    };

    // Phase 1 — FAANG university / new-grad portals
    const faangNew = await runPhase('faang', 'FAANG portals', () =>
      scrapeFaangPriorityPortals([], jobType)
    );

    // Phase 2 — GitHub curated lists + Simplify Top New Grad
    const githubNew = await runPhase('github', 'GitHub + Simplify lists', async () => {
      const fromGithub = await scrapeGithubInternshipLists([], jobType);
      if (shouldAbortScrape()) return fromGithub;
      const fromSimplify = await scrapeSimplifyNewGradLists([], jobType);
      return [...fromGithub, ...fromSimplify];
    });

    // Phase 3 — Scoutify (public realtime feed, US eng / full-time / YOE capped)
    const scoutifyNew = await runPhase('scoutify', 'Scoutify', () =>
      scrapeScoutifyJobs([], jobType)
    );

    // Phase 4 — Jobright
    const jobrightNew = await runPhase('jobright', 'Jobright', () =>
      scrapeJobrightJobs([], jobType)
    );

    // Phase 5 — LinkedIn
    const linkedinNew = await runPhase('linkedin', 'LinkedIn', () =>
      scrapeLinkedInJobs([], jobType)
    );

    // Phase 6 — Indeed
    const indeedNew = await runPhase('indeed', 'Indeed', () => scrapeIndeedJobs([], jobType));

    // Phase 7 — Google Jobs
    const portalNew = await runPhase('portals', 'Google Jobs', () =>
      scrapePriorityCareerPortals(jobType)
    );

    // Phase 8 — ATS boards
    const atsNew = await runPhase('ats', 'ATS boards', () => scrapeAtsBoards(jobType));

    const allNew = [
      ...faangNew,
      ...githubNew,
      ...scoutifyNew,
      ...jobrightNew,
      ...linkedinNew,
      ...indeedNew,
      ...portalNew,
      ...atsNew,
    ];
    if (!shouldAbortScrape() && allNew.length) {
      setTaskPhase('resumes', `Generating ${allNew.length} resume(s) one by one…`);
      await runResumePipelineQueue(allNew, true);
    }

    const total = allNew.length;
    const summary =
      `Pipeline done — ${total}/${totalCap} job(s). FAANG ${faangNew.length}, GitHub ${githubNew.length}, ` +
      `Scoutify ${scoutifyNew.length}, Jobright ${jobrightNew.length}, LinkedIn ${linkedinNew.length}, Indeed ${indeedNew.length}, ` +
      `Google ${portalNew.length}, ATS ${atsNew.length}.`;

    if (shouldAbortScrape()) abortTask(`Stopped. ${summary}`);
    else finishTask(summary);

    return {
      deleted,
      faangPortals: faangNew.length,
      githubLists: githubNew.length,
      scoutify: scoutifyNew.length,
      jobright: jobrightNew.length,
      linkedin: linkedinNew.length,
      careerPortals: portalNew.length + indeedNew.length,
      ats: atsNew.length,
      total,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setTaskError(msg);
    throw err;
  } finally {
    pipelineRunning = false;
    clearStopRequest();
    noteManualActivity();
  }
}

/**
 * LinkedIn Easy Apply one-by-one for ready resumes (fallback path).
 * Skips FAANG/MANGO. Pauses in UI for message + Submit approval.
 */
export async function runLinkedInApplyQueue(limit = 50): Promise<number> {
  const jobs = await Job.find({
    priority: { $ne: 'faang' },
    pdfPath: { $exists: true, $nin: [null, ''] },
    status: { $in: ['pending_resume_approval', 'pdf_uploaded', 'resume_generated'] },
    url: /linkedin\.com\/(jobs|job)/i,
  })
    .sort({ createdAt: 1 })
    .limit(limit);

  let started = 0;
  for (const job of jobs) {
    if (shouldAbortScrape()) break;
    if (!isLinkedInEasyApplyUrl(job.url)) continue;

    if (job.status === 'pending_resume_approval' || job.status === 'resume_generated') {
      job.status = 'pdf_uploaded';
      job.pendingAction = null;
      job.approvalNote =
        'Starting LinkedIn Easy Apply — approve the message and final Submit in the tracker.';
      await job.save();
    }

    appendTaskLog(`🔗 Easy Apply: ${job.title} @ ${job.company}`);
    try {
      await autoApplyToJob(job.id);
      started += 1;
    } catch (err) {
      console.error(`Apply failed for ${job.id}:`, err);
      appendTaskLog(`Apply failed: ${job.title} — ${err instanceof Error ? err.message : err}`);
    }
  }

  appendTaskLog(`LinkedIn apply queue finished — ${started} job(s) processed.`);
  return started;
}

/**
 * Career-page / ATS apply queue (primary). One at a time on orange Chrome.
 * Prefers Greenhouse/Lever/Ashby/Workday/company URLs; skips LinkedIn + FAANG.
 * Pauses at final Submit for your approval.
 */
export async function runCareerApplyQueue(limit = 20): Promise<number> {
  if (scrapeRunning || pipelineRunning) {
    throw new Error('Another pipeline task is already running.');
  }

  pipelineRunning = true;
  startTask('applying_career', 'Career-page apply queue…', 'apply');
  clearStopRequest();
  noteManualActivity();

  try {
    const jobs = await Job.find({
      priority: { $ne: 'faang' },
      pdfPath: { $exists: true, $nin: [null, ''] },
      status: { $in: ['pdf_uploaded', 'resume_generated', 'confused_hold'] },
      url: { $not: /linkedin\.com\/(jobs|job)/i },
      jobType: 'fulltime',
    })
      .sort({ createdAt: 1 })
      .limit(limit);

    setTaskProgress(0, jobs.length, `Career apply 0/${jobs.length}`);
    let started = 0;

    for (let i = 0; i < jobs.length; i += 1) {
      if (shouldAbortScrape()) break;
      const job = jobs[i];

      if (job.status === 'resume_generated') {
        job.status = 'pdf_uploaded';
        job.pendingAction = null;
      }
      job.approvalNote =
        'Starting career-page apply — review Chrome, then Approve Submit in the tracker.';
      await job.save();

      appendTaskLog(`🏢 Career apply: ${job.title} @ ${job.company}`);
      setTaskProgress(i + 1, jobs.length, `Career apply ${i + 1}/${jobs.length}`);
      try {
        await autoApplyToJob(job.id);
        started += 1;
      } catch (err) {
        console.error(`Career apply failed for ${job.id}:`, err);
        appendTaskLog(
          `Career apply failed: ${job.title} — ${err instanceof Error ? err.message : err}`
        );
      }
    }

    const msg = `Career apply queue finished — ${started} job(s) processed.`;
    finishTask(msg);
    return started;
  } catch (err) {
    setTaskError(err);
    throw err;
  } finally {
    pipelineRunning = false;
    clearStopRequest();
    noteManualActivity();
  }
}

export async function runScrapeOnly() {
  if (scrapeRunning || pipelineRunning) {
    return { scraped: 0, sources: ['career_portal'] };
  }
  const result = await runScrapeCareerPortals();
  return { scraped: result.scraped, sources: ['career_portal'] };
}

export async function runFullTimeScrapeOnly() {
  if (scrapeRunning) {
    return { scraped: 0, sources: ['jobright', 'linkedin', 'indeed'] };
  }

  scrapeRunning = true;
  try {
    let savedJobIds: string[] = [];
    await scrapeJobrightJobs(savedJobIds, 'fulltime');
    savedJobIds = await scrapeLinkedInJobs(savedJobIds, 'fulltime');
    savedJobIds = await scrapeIndeedJobs(savedJobIds, 'fulltime');
    return { scraped: savedJobIds.length, sources: ['jobright', 'linkedin', 'indeed'] };
  } finally {
    scrapeRunning = false;
  }
}

export { refreshExistingJobs, deleteAllJobs };

export async function runScrapeThenResumes() {
  return runScrapeOnly();
}

function enqueueClaudeOnly(jobId: string): Promise<void> {
  resumeChain = resumeChain
    .then(() => runClaudeOnlyPipeline(jobId))
    .catch((err) => {
      console.error(`Claude-only pipeline failed for ${jobId}:`, err);
    });
  return resumeChain;
}

export async function rerunClaudeForJobsWithLatex() {
  const jobs = await Job.find({
    $or: [
      { latexResume: { $exists: true, $nin: [null, ''] } },
      { status: { $in: ['failed', 'resume_generating', 'resume_generated'] } },
    ],
  }).sort({ createdAt: 1 });

  if (!jobs.length) return { count: 0 };

  for (let i = 0; i < jobs.length; i++) {
    await enqueueClaudeOnly(jobs[i].id);
  }
  return { count: jobs.length };
}

export function enqueueSingleClaude(jobId: string) {
  return enqueueClaudeOnly(jobId);
}

export function enqueueSingleResume(jobId: string) {
  if (resumeBatchRunning || resumePreparationRunning) {
    throw new Error('A resume batch is already running. Stop it or wait, then retry this job.');
  }
  return enqueueResume(jobId);
}

export function enqueueSingleOllamaResume(jobId: string) {
  if (resumeBatchRunning || resumePreparationRunning) {
    throw new Error('A resume batch is already running. Stop it or wait, then retry this job.');
  }
  return enqueueResume(jobId);
}

export function stopCurrentTask() {
  requestTaskStop();
}

/**
 * Stop the active task. Keep `stopRequested` true and do NOT clear `scrapeRunning`
 * here — the in-flight scrape `finally` owns that. Clearing both early let Jobright
 * keep saving while resumes started on top of it.
 */
export function forceStopCurrentTask() {
  requestTaskStop();
  noteManualActivity();
}
