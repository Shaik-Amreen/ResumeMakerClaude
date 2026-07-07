import { runResumePipeline, runClaudeOnlyPipeline } from './pipelineService';
import { scrapePriorityCareerPortals } from './careerPortalScraper';
import { scrapeJobrightJobs } from './jobrightScraper';
import { scrapeLinkedInJobs } from './linkedinScraper';
import { scrapeIndeedJobs } from './indeedScraper';
import { refreshExistingJobs } from './jobRefresher';
import { pruneNonSoftwareJobs, resetAllJobsToScraped } from './jobMaintenance';
import { runOllamaResumePipeline } from './ollamaResumePipeline';
import Job from '../models/Job';

/** Serial queue — only one resume pipeline at a time, never parallel. */
let resumeChain: Promise<void> = Promise.resolve();
let scrapeRunning = false;

export function isScrapeRunning(): boolean {
  return scrapeRunning;
}

function enqueueResume(jobId: string): Promise<void> {
  resumeChain = resumeChain
    .then(() => runResumePipeline(jobId))
    .catch((err) => {
      console.error(`Resume pipeline failed for ${jobId}:`, err);
    });
  return resumeChain;
}

export async function runResumePipelineQueue(jobIds: string[]) {
  for (let i = 0; i < jobIds.length; i++) {
    console.log(`\n📄 Generating resume ${i + 1}/${jobIds.length} (sequential, not parallel)`);
    await enqueueResume(jobIds[i]);
  }
}

/** Generate resumes one-by-one for all jobs still in `scraped` status. */
export async function runResumesForScrapedJobs() {
  const jobs = await Job.find({ status: 'scraped' }).sort({ createdAt: 1 });
  const jobIds = jobs.map((j) => j.id);

  if (!jobIds.length) {
    console.log('\nNo scraped jobs waiting for resume generation.');
    return { count: 0 };
  }

  console.log(`\n📋 Starting sequential resume queue for ${jobIds.length} jobs...`);
  await runResumePipelineQueue(jobIds);
  console.log(`\n✅ Resume queue complete — ${jobIds.length} jobs processed.`);
  return { count: jobIds.length };
}

/** Remove hardware/non-SWE jobs, reset remaining to scraped, then generate resumes one by one. */
export async function prepareAndGenerateResumes() {
  const removed = await pruneNonSoftwareJobs();
  const reset = await resetAllJobsToScraped();
  const remaining = await Job.countDocuments();

  console.log(`\n🧹 Removed ${removed} non-software jobs. Reset ${reset} to scraped. ${remaining} software jobs remain.`);

  return runResumesForScrapedJobs();
}

/** Scrape FAANG + MANGOES company career portals only (Summer 2027 SWE interns). */
export async function runScrapeOnly() {
  if (scrapeRunning) {
    console.log('\n⏭ Scrape already running — not starting another.');
    return { scraped: 0, sources: ['career_portal'] };
  }

  scrapeRunning = true;
  try {
    console.log('\n🎯 FAANG + MANGOES career portals — Summer 2027 software internships');

    const count = await scrapePriorityCareerPortals();

    if (!count) {
      console.log('\nNo new jobs scraped this run.');
      return { scraped: 0, sources: ['career_portal'] };
    }

    console.log(`\n✅ FAANG/MANGOES portal scrape complete — ${count} new job(s).`);
    return { scraped: count, sources: ['career_portal'] };
  } finally {
    scrapeRunning = false;
  }
}

/** Scrape full-time software roles — Jobright → LinkedIn → Indeed (newest first). */
export async function runFullTimeScrapeOnly() {
  if (scrapeRunning) {
    console.log('\n⏭ Scrape already running — not starting another.');
    return { scraped: 0, sources: ['jobright', 'linkedin', 'indeed'] };
  }

  scrapeRunning = true;
  try {
    let savedJobIds: string[] = [];

    console.log('\n🎯 Full-time software roles — Jobright → LinkedIn → Indeed');

    await scrapeJobrightJobs(savedJobIds, 'fulltime');

    savedJobIds = await scrapeLinkedInJobs(savedJobIds, 'fulltime');

    savedJobIds = await scrapeIndeedJobs(savedJobIds, 'fulltime');

    if (!savedJobIds.length) {
      console.log('\nNo new full-time jobs scraped this run.');
      return { scraped: 0, sources: ['jobright', 'linkedin', 'indeed'] };
    }

    console.log(`\n✅ Full-time scrape complete — ${savedJobIds.length} new job(s).`);
    return { scraped: savedJobIds.length, sources: ['jobright', 'linkedin', 'indeed'] };
  } finally {
    scrapeRunning = false;
  }
}

export { refreshExistingJobs };

/** @deprecated Use runScrapeOnly — resumes are manual now. */
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

  if (!jobs.length) {
    console.log('\nNo jobs with saved LaTeX — nothing to send to Claude.');
    return { count: 0 };
  }

  console.log(`\n📋 Claude-only queue for ${jobs.length} jobs (skip ChatGPT)...`);
  for (let i = 0; i < jobs.length; i++) {
    console.log(`\n🤖 Claude rerun ${i + 1}/${jobs.length} (sequential)`);
    await enqueueClaudeOnly(jobs[i].id);
  }
  console.log(`\n✅ Claude-only queue complete — ${jobs.length} jobs processed.`);
  return { count: jobs.length };
}

export function enqueueSingleClaude(jobId: string) {
  return enqueueClaudeOnly(jobId);
}

export function enqueueSingleResume(jobId: string) {
  return enqueueResume(jobId);
}

function enqueueOllamaResume(jobId: string): Promise<void> {
  resumeChain = resumeChain
    .then(() => runOllamaResumePipeline(jobId))
    .catch((err) => {
      console.error(`Ollama resume pipeline failed for ${jobId}:`, err);
    });
  return resumeChain;
}

export function enqueueSingleOllamaResume(jobId: string) {
  return enqueueOllamaResume(jobId);
}
