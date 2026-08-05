import Job from '../models/Job';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { inferJobType, isEligibleJob, isInternshipTitle, isSoftwareRole } from './eligibility';
import { isDuplicateJob } from './jobDedup';
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
  | 'simplify'
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

  if (forcedType === 'internship' || isInternshipTitle(title) || inferJobType(title) === 'internship') {
    console.log(`  ↳ Skipped — internship/co-op (full-time / new-grad only)`);
    return null;
  }

  if (!isEligibleJob('fulltime', title, jobDescription)) {
    return null;
  }

  const jobType: JobType = 'fulltime';

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
        ? `🚨 FAANG/MANGO — Full-time software role (${source}). Apply ASAP.`
        : config.autoResume.enabled
          ? `Full-time software role (${source}) — resume generating automatically.`
          : `Full-time software role (${source}) — tailor resume & upload PDF.`,
  }).save();

  if (priority === 'faang') {
    const label = '🚨 FAANG/MANGO full-time opening';
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
