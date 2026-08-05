import Job from '../models/Job';
import { applyLinkedInJob } from './linkedinApplier';
import { applyExternalJob } from './externalApplier';

function usesLinkedInEasyApply(url: string): boolean {
  return /linkedin\.com\/(jobs|job)/i.test(url);
}

/**
 * Apply flow:
 * - FAANG/MANGO: never auto-apply (alert only)
 * - LinkedIn Easy Apply (internship or full-time): fill form, wait for your approval before Submit
 * - Other full-time sources: external applier with submit approval
 * - Non-LinkedIn internships: manual apply on company site
 */
export async function autoApplyToJob(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');

  if (job.priority === 'faang') {
    throw new Error(
      'FAANG/MANGO roles are never auto-applied. Open the job link and apply yourself.'
    );
  }

  if (!job.pdfPath) {
    throw new Error('Approve/build a 2-page PDF before applying.');
  }

  if (usesLinkedInEasyApply(job.url)) {
    return applyLinkedInJob(jobId);
  }

  if (String(job.jobType) === 'internship') {
    throw new Error(
      'This internship is not a LinkedIn Easy Apply listing. Open the company link and apply manually.'
    );
  }

  return applyExternalJob(jobId);
}

export function isLinkedInEasyApplyUrl(url: string): boolean {
  return usesLinkedInEasyApply(url);
}
