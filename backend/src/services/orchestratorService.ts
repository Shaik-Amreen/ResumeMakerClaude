import { config } from '../config';
import { enqueueResume, isResumeQueueIdle } from './resumeQueue';
import { scrapePriorityCareerPortals } from './careerPortalScraper';
import { scrapeJobrightJobs } from './jobrightScraper';
import { scrapeLinkedInJobs } from './linkedinScraper';
import { scrapeIndeedJobs } from './indeedScraper';
import { scrapeAtsBoards } from './atsScraper';
import { scrapeFaangPriorityPortals } from './faangPortalScraper';
import { scrapeGithubInternshipLists } from './githubInternshipScraper';
import { refreshExistingJobs } from './jobRefresher';
import { deleteAllJobs, pruneNonSoftwareJobs, resetAllJobsToScraped } from './jobMaintenance';
import { runClaudeOnlyPipeline } from './pipelineService';
import { shouldAbortScrape, withScrapeRun } from './scrapeContext';
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
  startTask,
} from './taskStatusService';
import Job from '../models/Job';
import { noteManualActivity } from './schedulerService';

/** Serial queue lives in resumeQueue.ts */
let resumeChain: Promise<void> = Promise.resolve();
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
  for (let i = startIndex; i < jobIds.length; i++) {
    if (shouldAbortScrape()) {
      appendTaskLog(`Resume queue stopped at ${i}/${jobIds.length}`);
      break;
    }
    setResumeProgress(i + 1, jobIds.length);
    appendTaskLog(`📄 Resume ${i + 1}/${jobIds.length}`);
    await enqueueResume(jobIds[i]);
    if (withOutreach) {
      try {
        await generateOutreachArtifacts(jobIds[i]);
      } catch (err) {
        console.error(`Outreach failed for ${jobIds[i]}:`, err);
      }
    }
  }
}

/** Generate resumes one-by-one for jobs still in scraped status only. */
export async function runResumesForScrapedJobs(options?: {
  limit?: number;
  withOutreach?: boolean;
}) {
  if (scrapeRunning || pipelineRunning || resumeBatchRunning) {
    throw new Error('Another scrape, pipeline, or resume batch is already running.');
  }
  resumeBatchRunning = true;
  clearStopRequest();
  startTask('generating_resumes', 'Preparing the sequential resume queue…');

  const limit = options?.limit && options.limit > 0 ? options.limit : 0;
  try {
    // Only jobs that have never left scraped — do not retry failed / partial / generating.
    const query = Job.find({ status: 'scraped' }).sort({ createdAt: 1 });
    const jobs = limit ? await query.limit(limit) : await query;
    const jobIds = jobs.map((j) => j.id);

    if (!jobIds.length) {
      finishTask('No scraped jobs waiting for resume generation.');
      return { count: 0 };
    }

    setTaskPhase(
      'resumes',
      `Generating ${jobIds.length} resume(s) for scraped jobs only (one by one)…`
    );
    await runResumePipelineQueue(jobIds, options?.withOutreach ?? false);
    if (shouldAbortScrape()) {
      abortTask(`Stopped — processed ${jobIds.length} resume slot(s) before stop.`);
    } else {
      finishTask(`Resume queue complete — ${jobIds.length} scraped job(s) processed.`);
    }
    return { count: jobIds.length };
  } catch (err) {
    setTaskError(err);
    abortTask('Resume generation failed.');
    throw err;
  } finally {
    resumeBatchRunning = false;
    clearStopRequest();
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
    | 'scraping_ats',
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

export function runScrapeCareerPortals(cap?: number) {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_career_portals', 'Google Jobs', limit, () =>
    scrapePriorityCareerPortals()
  );
}

export function runScrapeFaangPortals(cap?: number) {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_faang_portals', 'FAANG portals', limit, () =>
    scrapeFaangPriorityPortals([])
  );
}

export function runScrapeGithubLists(cap?: number) {
  const limit = cap ?? config.pipeline.perSourceCap;
  return runSingleSourceScrape('scraping_github_lists', 'GitHub internship lists', limit, () =>
    scrapeGithubInternshipLists([])
  );
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

export interface MasterPipelineResult {
  deleted: number;
  faangPortals: number;
  githubLists: number;
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
  const jobType = options?.jobType ?? 'fulltime';
  let deleted = 0;
  let remaining = totalCap;

  startTask(
    'master_pipeline',
    `Master pipeline started — ${jobType === 'fulltime' ? 'full-time / new-grad' : 'internship (legacy)'} (max ${totalCap} jobs total)`,
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

    // Phase 1 — FAANG university portals
    const faangNew =
      jobType === 'internship'
        ? await runPhase('faang', 'FAANG portals', () => scrapeFaangPriorityPortals([]))
        : [];

    // Phase 2 — GitHub lists
    const githubNew =
      jobType === 'internship'
        ? await runPhase('github', 'GitHub lists', () => scrapeGithubInternshipLists([]))
        : [];

    // Phase 3 — Jobright
    const jobrightNew = await runPhase('jobright', 'Jobright', () =>
      scrapeJobrightJobs([], jobType)
    );

    // Phase 4 — LinkedIn
    const linkedinNew = await runPhase('linkedin', 'LinkedIn', () =>
      scrapeLinkedInJobs([], jobType)
    );

    // Phase 5 — Google Jobs (intern) or Indeed (full-time)
    const portalNew = await runPhase(
      jobType === 'fulltime' ? 'indeed' : 'portals',
      jobType === 'fulltime' ? 'Indeed' : 'Google Jobs',
      () =>
        jobType === 'fulltime' ? scrapeIndeedJobs([], jobType) : scrapePriorityCareerPortals()
    );

    // Phase 6 — ATS boards
    const atsNew = await runPhase('ats', 'ATS boards', () => scrapeAtsBoards(jobType));

    const allNew = [...faangNew, ...githubNew, ...jobrightNew, ...linkedinNew, ...portalNew, ...atsNew];
    if (!shouldAbortScrape() && allNew.length) {
      setTaskPhase('resumes', `Generating ${allNew.length} resume(s) one by one…`);
      await runResumePipelineQueue(allNew, true);
    }

    const fifthLabel = jobType === 'fulltime' ? 'Indeed' : 'Google';
    const total = allNew.length;
    const summary =
      `Pipeline done — ${total}/${totalCap} job(s). FAANG ${faangNew.length}, GitHub ${githubNew.length}, ` +
      `Jobright ${jobrightNew.length}, LinkedIn ${linkedinNew.length}, ${fifthLabel} ${portalNew.length}, ATS ${atsNew.length}.`;

    if (shouldAbortScrape()) abortTask(`Stopped. ${summary}`);
    else finishTask(summary);

    return {
      deleted,
      faangPortals: faangNew.length,
      githubLists: githubNew.length,
      jobright: jobrightNew.length,
      linkedin: linkedinNew.length,
      careerPortals: portalNew.length,
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
 * LinkedIn Easy Apply one-by-one for ready resumes.
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
  return enqueueResume(jobId);
}

export function enqueueSingleOllamaResume(jobId: string) {
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
