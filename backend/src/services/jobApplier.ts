import Job from '../models/Job';
import { applyLinkedInJob } from './linkedinApplier';
import { applyCareerPageJob } from './careerPageApplier';
import { detectAts, isLinkedInEasyApplyUrl, prefersCareerApply } from './atsDetector';

/**
 * Apply flow (career-page first):
 * - FAANG/MANGO: never auto-apply (alert only)
 * - Career / ATS URLs (Greenhouse, Lever, Ashby, Workday, company sites): careerPageApplier
 * - LinkedIn Easy Apply: fallback only (message + submit approval)
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
    throw new Error('Approve/build a PDF before applying.');
  }

  if (String(job.jobType) === 'internship') {
    throw new Error(
      'Internship listings are ignored. This tracker is full-time / new-grad only.'
    );
  }

  const detection = detectAts(job.url, job.source);

  // Career pages are the primary apply path.
  if (prefersCareerApply(job.url, job.source) && detection.ats !== 'linkedin') {
    return applyCareerPageJob(jobId);
  }

  if (isLinkedInEasyApplyUrl(job.url)) {
    return applyLinkedInJob(jobId);
  }

  return applyCareerPageJob(jobId);
}

export { isLinkedInEasyApplyUrl, prefersCareerApply, detectAts };
