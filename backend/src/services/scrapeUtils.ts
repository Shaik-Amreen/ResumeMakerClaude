import Job from '../models/Job';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { inferJobType, isEligibleJob, isSoftwareRole } from './eligibility';
import { isDuplicateJob } from './jobDedup';
import { isSummer2027InternTarget } from './jobMaintenance';
import { shouldSkipJobDescription } from './jobSkipRules';
import { isUsJobLocation } from './usLocation';
import { sendEmailNotification } from './notifier';
import { config } from '../config';
import { enqueueResume } from './resumeQueue';
import { getActiveScrapeOptions, shouldSkipAutoResume } from './scrapeContext';
import { resolvePostedAt } from '../utils/parsePostedDate';
import { cleanJobDescriptionForResume } from './cleanJobDescription';
import { isInvalidOrMissingJd } from './applyPageJdFetcher';
import type { JobType } from '../models/Job';

export type ScrapeSource =
  | 'jobright'
  | 'linkedin'
  | 'indeed'
  | 'career_portal'
  | 'greenhouse'
  | 'lever'
  | 'github'
  | 'company_portal'
  | 'other';

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
  pipelinePhase?: 'jobright' | 'linkedin' | 'career_portal';
}

export async function saveJobIfNew(payload: ScrapedJobPayload): Promise<string | null> {
  const title = (payload.title || '').trim();
  const company = (payload.company || '').trim();
  const url = (payload.url || '').trim();
  const jobDescription = cleanJobDescriptionForResume(payload.jobDescription || '');
  const { forcedType, source } = payload;

  if (!title || !company || !jobDescription || !url) return null;

  if (isInvalidOrMissingJd(jobDescription)) {
    console.log(`  ↳ Skipped — invalid / missing JD (dead posting or ATS chrome)`);
    return null;
  }

  if (!isSoftwareRole(title, jobDescription)) return null;

  if (!isUsJobLocation(payload.location, jobDescription)) {
    console.log(`  ↳ Skipped — not a U.S. location (${payload.location || 'unknown'})`);
    return null;
  }

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
    pipelinePhase: payload.pipelinePhase,
    status: 'scraped',
    approvalNote:
      priority === 'faang'
        ? jobType === 'internship'
          ? `🚨 FAANG/MANGO — software intern (${source}). Apply ASAP.`
          : `🚨 FAANG/MANGO — Full-time software role (${source}). Apply ASAP.`
        : jobType === 'internship'
          ? config.autoResume.enabled
            ? `Software intern (${source}) — resume generating automatically.`
            : `Software intern (${source}) — apply early. Tailor resume & upload PDF.`
          : config.autoResume.enabled
            ? `Full-time software role (${source}) — resume generating automatically.`
            : `Full-time software role (${source}) — tailor resume & upload PDF.`,
  }).save();

  if (priority === 'faang') {
    const label =
      jobType === 'internship'
        ? '🚨 FAANG/MANGO internship OPENING'
        : '🚨 FAANG/MANGO full-time opening';
    await sendEmailNotification(
      `${label}\n${title}\n${company}\n${url}\n\n⚠️ Do NOT auto-apply — open the link and apply yourself ASAP.\nResume will be generated in the job tracker for you to download.`
    );
  }

  if (config.autoResume.enabled && !shouldSkipAutoResume()) {
    console.log(`  ↳ Auto-resume queued for ${title} @ ${company}`);
    enqueueResume(job.id);
  }

  return job.id;
}
