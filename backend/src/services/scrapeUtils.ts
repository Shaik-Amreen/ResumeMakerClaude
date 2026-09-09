import Job from '../models/Job';
import { sourceQualityRank } from '../data/candidateTargeting';
import { isFaangMangoCompany } from '../data/priorityCompanies';
import { resolveCompanyRating } from '../data/h1bCompanyRatings';
import { inferJobType, isEligibleJob, isInternshipTitle, isSoftwareRole } from './eligibility';
import { findDuplicateJob } from './jobDedup';
import { shouldSkipJobDescription } from './jobSkipRules';
import { isUsJobLocation } from './usLocation';
import { sendEmailNotification } from './notifier';
import { config } from '../config';
import { enqueueResume } from './resumeQueue';
import { shouldSkipAutoResume } from './scrapeContext';
import { resolvePostedAt } from '../utils/parsePostedDate';
import { cleanJobDescriptionForResume } from './cleanJobDescription';
import { isInvalidOrMissingJd } from './applyPageJdFetcher';
import type { JobType } from '../models/Job';
import { evaluateJobWithAI } from './aiJobFilter';
import { isJdRichEnoughForResume, preferBetterJd, scoreJdQuality } from './jdQuality';
import { gateCompanyForScrape, verifyCompany } from './companyVerifyService';

/** Re-export — scrapers should call this as the first step per listing. */
export { gateCompanyForScrape };

const TERMINAL_STATUSES = new Set(['applied', 'assessment', 'interview', 'accepted', 'rejected']);

export type ScrapeSource =
  | 'jobright'
  | 'linkedin'
  | 'indeed'
  | 'career_portal'
  | 'greenhouse'
  | 'lever'
  | 'github'
  | 'simplify'
  | 'scoutify'
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

  // FIRST: company verification (staffing / dummy consultancies / Clearbit+Wikipedia)
  const verified = await verifyCompany(company, jobDescription);
  if (verified.skip) {
    console.log(`  ↳ Skipped company verify FIRST — ${verified.reason}`);
    return null;
  }

  if (isInvalidOrMissingJd(jobDescription)) {
    console.log(`  ↳ Skipped — invalid / missing JD (dead posting or ATS chrome)`);
    return null;
  }

  if (!isSoftwareRole(title, jobDescription)) return null;

  if (!isUsJobLocation(payload.location, `${title}\n${jobDescription}`)) {
    console.log(`  ↳ Skipped — not a U.S. location (title: "${title}", location: ${payload.location || 'unknown'})`);
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

  // AI Semantic Filter Check
  console.log(`  ↳ Evaluating semantics with AI...`);
  const aiResult = await evaluateJobWithAI(title, company, jobDescription);
  if (aiResult && !aiResult.eligible) {
    console.log(`  ↳ Skipped by AI — ${aiResult.reason}`);
    return null;
  } else if (aiResult && aiResult.eligible) {
    console.log(`  ↳ AI Approved — ${aiResult.reason}`);
  } else {
    console.log(`  ↳ AI Filter skipped/failed. Proceeding via regex approval.`);
  }

  const jobType: JobType = 'fulltime';

  const existing = await findDuplicateJob(url, title, company);
  if (existing) {
    // Prefer official career / ATS URL over job boards when same company + similar title
    const newRank = sourceQualityRank(source);
    const oldRank = sourceQualityRank(existing.source);
    const betterJd = preferBetterJd(existing.jobDescription || '', jobDescription, 'b');
    const jdImproved =
      scoreJdQuality(betterJd) > scoreJdQuality(existing.jobDescription || '') + 40;

    if (
      newRank > oldRank &&
      !TERMINAL_STATUSES.has(String(existing.status || '')) &&
      url &&
      url !== existing.url
    ) {
      const prevSource = existing.source;
      existing.url = url;
      existing.source = source;
      if (jdImproved) existing.jobDescription = betterJd;
      if (payload.location && !existing.location) existing.location = payload.location;
      await existing.save();
      console.log(
        `  ↳ Duplicate upgraded to higher-quality source (${prevSource} → ${source}): ${title} @ ${company}`
      );
    } else if (jdImproved && !TERMINAL_STATUSES.has(String(existing.status || ''))) {
      existing.jobDescription = betterJd;
      await existing.save();
      console.log(`  ↳ Duplicate kept — upgraded JD quality (${betterJd.length} chars): ${title} @ ${company}`);
    } else {
      console.log(`  ↳ Skipped — duplicate (same company + similar title): ${title} @ ${company}`);
    }
    return null;
  }

  const priority = payload.priority ?? (isFaangMangoCompany(company) ? 'faang' : 'standard');
  const postedAt = payload.postedAt ?? resolvePostedAt(payload.posted);
  // Prefer live verification rating (already includes H1B seed + JD heuristics).
  const companyRate =
    verified.rating != null
      ? { rating: verified.rating, reason: verified.ratingReason }
      : resolveCompanyRating(company, jobDescription);
  const richJd = isJdRichEnoughForResume(jobDescription);

  const verifyNote =
    verified.status === 'verified' || verified.status === 'likely_real'
      ? ` · ${verified.status}${verified.domain ? ` · ${verified.domain}` : ''}`
      : verified.status === 'suspicious' || verified.status === 'unknown'
        ? ` · ⚠ ${verified.status}`
        : '';

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
    companyRating: companyRate.rating,
    companyRatingReason: companyRate.reason,
    companyVerifyStatus: verified.status,
    companyVerifyReason: verified.reason,
    companyDomain: verified.domain,
    companyReviewLinks: verified.reviewLinks,
    pipelinePhase: payload.pipelinePhase,
    status: 'scraped',
    approvalNote:
      priority === 'faang'
        ? richJd
          ? `🚨 FAANG/MANGO — Full-time software role (${source})${verifyNote}. Apply ASAP.`
          : `🚨 FAANG/MANGO — JD looks thin (${jobDescription.length} chars). Refetch JD before generating.`
        : richJd
          ? config.autoResume.enabled
            ? `Full-time software role (${source})${verifyNote} — resume generating automatically.`
            : `Full-time software role (${source})${verifyNote} — tailor resume & upload PDF.`
          : `Full-time software role (${source})${verifyNote} — JD too thin for auto-resume (${jobDescription.length} chars). Use Refetch JD or paste full posting.`,
  }).save();

  console.log(
    `  ↳ Company verify: ${verified.status} · ★${companyRate.rating} — ${verified.reason.slice(0, 120)}`
  );

  if (priority === 'faang') {
    const label = '🚨 FAANG/MANGO full-time opening';
    await sendEmailNotification(
      `${label}\n${title}\n${company}\n${url}\n\n⚠️ Do NOT auto-apply — open the link and apply yourself ASAP.\nResume will be generated in the job tracker for you to download.`
    );
  }

  if (config.autoResume.enabled && !shouldSkipAutoResume() && richJd) {
    console.log(`  ↳ Auto-resume queued for ${title} @ ${company}`);
    enqueueResume(job.id);
  } else if (!richJd) {
    console.log(
      `  ↳ Saved without auto-resume — JD not rich enough (${jobDescription.length} chars, score ${scoreJdQuality(jobDescription)})`
    );
  }

  return job.id;
}
