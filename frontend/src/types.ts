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
  | 'failed';

export type JobSource = 'jobright' | 'linkedin' | 'indeed' | 'career_portal' | 'other';

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
  status: JobStatus;
  matchScore?: number;
  latexResume?: string;
  pdfPath?: string;
  /** e.g. /uploads/jobid-timestamp-resume.pdf */
  pdfUrl?: string;
  recruiterMessageDraft?: string;
  pendingAction?: 'resume_review' | 'message_send' | 'submit_application' | null;
  approvalNote?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
