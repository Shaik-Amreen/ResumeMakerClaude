import Job from '../models/Job';
import { applyLinkedInJob } from './linkedinApplier';
import { applyExternalJob } from './externalApplier';

function usesLinkedInEasyApply(url: string): boolean {
  return /linkedin\.com\/(jobs|job)/i.test(url);
}

export function isLinkedInEasyApplyUrl(url: string): boolean {
  return usesLinkedInEasyApply(url);
}

/**
 * Auto-apply for full-time jobs only (all sources).
 * LinkedIn Easy Apply → linkedinApplier; everything else → externalApplier.
 * Always waits for your approval before final submit.
 */
export async function autoApplyToJob(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (job.jobType !== 'fulltime') {
    throw new Error('Auto-apply is enabled for full-time jobs only.');
  }
  if (usesLinkedInEasyApply(job.url)) {
    return applyLinkedInJob(jobId);
  }
  return applyExternalJob(jobId);
}
