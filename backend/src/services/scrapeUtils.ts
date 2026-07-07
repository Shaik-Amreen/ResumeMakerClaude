import Job from '../models/Job';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { inferJobType, isEligibleJob, isSoftwareRole } from './eligibility';
import { isDuplicateJob } from './jobDedup';
import { isSummer2027InternTarget } from './jobMaintenance';
import { shouldSkipJobDescription } from './jobSkipRules';
import { sendEmailNotification } from './notifier';
import { resolvePostedAt } from '../utils/parsePostedDate';
import type { JobType } from '../models/Job';

export type ScrapeSource = 'jobright' | 'linkedin' | 'indeed' | 'career_portal' | 'other';

export interface ScrapedJobPayload {
  title: string;
  company: string;
  url: string;
  jobDescription: string;
  location?: string;
  applicants?: string;
  posted?: string;
  postedAt?: Date;
  source: ScrapeSource;
  recruiterName?: string;
  recruiterProfileUrl?: string;
  forcedType?: JobType;
  priority?: 'faang' | 'standard';
}

export async function saveJobIfNew(payload: ScrapedJobPayload): Promise<string | null> {
  const { title, company, url, jobDescription, forcedType, source } = payload;

  if (!title || !company || !jobDescription || !url) return null;

  if (!isSoftwareRole(title, jobDescription)) return null;

  const skip = shouldSkipJobDescription(title, company, jobDescription);
  if (skip.skip) {
    console.log(`  ↳ Skipped — ${skip.reason}`);
    return null;
  }

  const jobType = forcedType || inferJobType(title, jobDescription);

  if (jobType === 'internship') {
    if (!isSummer2027InternTarget(title, jobDescription)) return null;
  } else if (!isEligibleJob('fulltime', title, jobDescription)) {
    return null;
  }

  if (await isDuplicateJob(url, title, company)) return null;

  const priority = payload.priority ?? (isFaangMangoCompany(company) ? 'faang' : 'standard');
  const postedAt = payload.postedAt ?? resolvePostedAt(payload.posted);

  const job = await new Job({
    title,
    company,
    url,
    jobDescription,
    jobType,
    location: payload.location,
    recruiterName: payload.recruiterName,
    recruiterProfileUrl: payload.recruiterProfileUrl,
    applicants: payload.applicants,
    posted: payload.posted,
    postedAt,
    linkedinApplicants: payload.applicants,
    linkedinPosted: payload.posted,
    source,
    priority,
    status: 'scraped',
    approvalNote:
      priority === 'faang'
        ? jobType === 'internship'
          ? `🚨 FAANG/MANGO — Summer 2027 software intern (${source}). Apply ASAP.`
          : `🚨 FAANG/MANGO — Full-time software role (${source}). Apply ASAP.`
        : jobType === 'internship'
          ? `Summer 2027 software intern (${source}) — apply early. Tailor resume & upload PDF.`
          : `Full-time software role (${source}) — tailor resume & upload PDF.`,
  }).save();

  if (priority === 'faang') {
    const label =
      jobType === 'internship'
        ? '🚨 FAANG/MANGO — new Summer 2027 intern posting'
        : '🚨 FAANG/MANGO — new full-time software posting';
    await sendEmailNotification(`${label}\n${title}\n${company}\n${url}\n\nOpen job tracker and apply early.`);
  }

  return job.id;
}
