import Job from '../models/Job';
import { isInternshipTitle, isNonSoftwareRole, isSoftwareRole } from './eligibility';
import { isInternGraduationEligible } from './internGraduation';
import { isUndergraduateOnlyJob } from './jobSkipRules';
import { removeAllResumeFiles, removeJobResumeFiles } from './resumeFiles';
import { isInvalidOrMissingJd } from './applyPageJdFetcher';

const SOFTWARE_TITLE =
  /\b(software|developer|swe|full[\s-]?stack|frontend|front[\s-]?end|backend|web|programming|computer\s+science)\b/i;

const NON_SWE_INTERN_TITLE = [
  /\bdata\s+scientist\b/i,
  /\bit\s+(support|specialist|analyst|intern)\b/i,
  /\bqa\s+(engineer|analyst|intern)\b/i,
  /\bproduct\s+(manager|owner|analyst)\b/i,
  /\bux\s+(designer|researcher|intern)\b/i,
  /\bnetwork\s+(admin|engineer)\b/i,
  /\bcyber\s+security\s+analyst\b/i,
  /\bmechanical\b/i,
  /\belectrical\b/i,
  /\bcivil\b/i,
];

/** Software internship target filter — MS grad January 2027. */
export function isSummer2027InternTarget(title: string, description: string): boolean {
  const text = `${title}\n${description}`;

  if (!isSoftwareRole(title, description) || isNonSoftwareRole(title, description)) return false;

  if (!SOFTWARE_TITLE.test(title)) return false;

  if (NON_SWE_INTERN_TITLE.some((p) => p.test(title))) return false;

  if (
    /\bsummer\s*2026\b|\bfall\s*2026\b|\bspring\s*2026\b|2026\s+start|\bintern.*\b2026\b|\b2026\b.*\bintern/i.test(
      text
    )
  ) {
    return false;
  }

  if (/\bfall\s*2027\b/i.test(text) && !/\bsummer\s*2027\b/i.test(text)) return false;

  if (/\bspring\s*2027\b/i.test(text) && /\bco-?op\b/i.test(title)) return false;

  if (/\bbci\b|brain[\s-]?computer|neuroscience engineer/i.test(text)) return false;

  if (/\bdrexel\s+university\s+co-?op/i.test(title)) return false;

  if (/intern\s*-\s*r&d/i.test(title) && !/\bweb\b|full[\s-]?stack|frontend|react|node/i.test(text)) {
    return false;
  }

  if (/work\s*study|tutor/i.test(title)) return false;

  const isIntern =
    /\bintern(ship)?\b/i.test(title) || /\bco-?op\b/i.test(title) || /\bintern(ship)?\b/i.test(text);
  if (!isIntern) return false;

  if (!isInternGraduationEligible(title, description)) return false;

  return true;
}

export async function pruneNonSummer2027Jobs(): Promise<{ removed: number; kept: number }> {
  const all = await Job.find();
  let removed = 0;
  let kept = 0;

  for (const job of all) {
    if (isSummer2027InternTarget(job.title, job.jobDescription)) {
      job.status = 'scraped';
      job.pendingAction = null;
      job.errorMessage = undefined;
      job.approvalNote = 'Software intern — tailor resume & upload PDF.';
      await job.save();
      kept += 1;
      console.log(`Kept: ${job.title} @ ${job.company}`);
      continue;
    }

    removeJobResumeFiles(job.id, job.pdfPath);
    await job.deleteOne();
    removed += 1;
    console.log(`Removed: ${job.title} @ ${job.company}`);
  }

  return { removed, kept };
}

export async function pruneNonSoftwareJobs(): Promise<number> {
  const all = await Job.find();
  let removed = 0;

  for (const job of all) {
    if (
      !isSoftwareRole(job.title, job.jobDescription) ||
      isUndergraduateOnlyJob(job.title, job.jobDescription) ||
      String(job.jobType) === 'internship' ||
      isInternshipTitle(job.title)
    ) {
      removeJobResumeFiles(job.id, job.pdfPath);
      await job.deleteOne();
      removed += 1;
      console.log(`Removed filtered job: ${job.title} @ ${job.company}`);
    }
  }

  return removed;
}

/**
 * Mark jobs whose stored JD is a dead posting / ATS "Job not found" shell
 * as invalid_job so they don't clog resume generation.
 */
export async function markJobsWithInvalidJd(): Promise<number> {
  const jobs = await Job.find({
    status: {
      $nin: ['invalid_job', 'confused_hold', 'accepted', 'applied', 'assessment', 'interview'],
    },
  }).select('title company jobDescription status approvalNote pendingAction errorMessage');

  let marked = 0;
  for (const job of jobs) {
    if (!isInvalidOrMissingJd(job.jobDescription || '')) continue;
    job.status = 'invalid_job';
    job.pendingAction = null;
    job.approvalNote =
      'Invalid job — apply page had no real JD (closed / Job not found / ATS chrome).';
    job.errorMessage = 'Missing or invalid job description';
    await job.save();
    marked += 1;
    console.log(`Marked invalid JD: ${job.title} @ ${job.company}`);
  }
  return marked;
}

/** Delete every job and optional PDF uploads — fresh start for master pipeline. */
export async function deleteAllJobs(): Promise<{ deleted: number; pdfsRemoved: number }> {
  const result = await Job.deleteMany({});
  const pdfsRemoved = removeAllResumeFiles();
  return { deleted: result.deletedCount ?? 0, pdfsRemoved };
}

/** Delete one job and its resume PDF/TeX uploads. */
export async function deleteJobById(
  id: string
): Promise<{ deleted: boolean; pdfsRemoved: number }> {
  const job = await Job.findById(id);
  if (!job) return { deleted: false, pdfsRemoved: 0 };

  const pdfsRemoved = removeJobResumeFiles(job.id, job.pdfPath);
  await job.deleteOne();
  return { deleted: true, pdfsRemoved };
}

export async function resetAllJobsToScraped(): Promise<number> {
  const jobs = await Job.find({}, { pdfPath: 1 });
  const result = await Job.updateMany(
    {},
    {
      $set: {
        status: 'scraped',
        pendingAction: null,
        approvalNote: 'Scraped — generate resume manually, then upload PDF.',
      },
      $unset: {
        latexResume: 1,
        pdfPath: 1,
        matchScore: 1,
        errorMessage: 1,
        recruiterMessageDraft: 1,
        coverLetterDraft: 1,
        contactSuggestions: 1,
        pipelinePhase: 1,
      },
    }
  );

  for (const job of jobs) {
    removeJobResumeFiles(job.id, job.pdfPath);
  }

  return result.modifiedCount;
}
