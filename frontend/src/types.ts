export type JobType = 'internship' | 'fulltime';

export type JobStatus =
  | 'scraped'
  | 'resume_generating'
  | 'resume_generated'
  | 'pending_resume_approval'
  | 'pdf_uploaded'
  | 'applying'
  | 'pending_message_approval'
  | 'pending_submit_approval'
  | 'applied'
  | 'assessment'
  | 'interview'
  | 'confused_hold'
  | 'invalid_job'
  | 'accepted'
  | 'failed';

export type ResumePhase =
  | 'idle'
  | 'saving_jd'
  | 'generating'
  | 'compiling'
  | 'checking_match'
  | 'repairing_match'
  | 'done'
  | 'failed';

export type ApplyPhase =
  | 'idle'
  | 'opening'
  | 'filling'
  | 'uploading'
  | 'awaiting_submit'
  | 'submitting'
  | 'done'
  | 'failed'
  | 'confused_hold';

export type AtsType =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'linkedin'
  | 'indeed'
  | 'unknown';

export type JobSource =
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

export interface ContactSuggestion {
  name?: string;
  title?: string;
  linkedinSearchQuery?: string;
  notes?: string;
}

export interface Job {
  _id: string;
  title: string;
  company: string;
  url: string;
  jobDescription: string;
  jobType: JobType;
  location?: string;
  recruiterName?: string;
  recruiterProfileUrl?: string;
  applicants?: string;
  posted?: string;
  postedAt?: string;
  /** Human label e.g. "Posted on LinkedIn: Mar 5, 2026" */
  postedOnPlatform?: string;
  /** @deprecated use applicants */
  linkedinApplicants?: string;
  /** @deprecated use posted */
  linkedinPosted?: string;
  source?: JobSource;
  platform?: JobSource;
  priority?: 'faang' | 'standard';
  /** 1–5 H1B + new-grad company quality */
  companyRating?: number;
  companyRatingReason?: string;
  status: JobStatus;
  matchScore?: number;
  keywordMatchScore?: number;
  matchedKeywords?: string[];
  missingKeywords?: string[];
  skillGaps?: string[];
  latexResume?: string;
  pdfPath?: string;
  /** e.g. /uploads/jobid-timestamp-resume.pdf */
  pdfUrl?: string;
  recruiterMessageDraft?: string;
  coverLetterDraft?: string;
  notes?: string;
  /** 1–5 excitement rating */
  interest?: number;
  followUpAt?: string;
  appliedAt?: string;
  contactSuggestions?: ContactSuggestion[];
  pipelinePhase?: 'jobright' | 'linkedin' | 'career_portal';
  pendingAction?: 'resume_review' | 'message_send' | 'submit_application' | null;
  resumePhase?: ResumePhase;
  applyPhase?: ApplyPhase;
  atsType?: AtsType;
  approvalNote?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
