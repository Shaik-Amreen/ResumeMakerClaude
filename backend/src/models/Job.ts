import mongoose, { Schema, Document } from 'mongoose';

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

export type PendingAction = 'resume_review' | 'message_send' | 'submit_application' | null;

/** Live progress while generating / regenerating a resume from a JD. */
export type ResumePhase =
  | 'idle'
  | 'saving_jd'
  | 'generating'
  | 'compiling'
  | 'checking_match'
  | 'repairing_match'
  | 'done'
  | 'failed';

/** Live progress while filling a career-page / ATS application. */
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

export interface ContactSuggestion {
  name?: string;
  title?: string;
  linkedinSearchQuery?: string;
  notes?: string;
}

export interface IJob extends Document {
  title: string;
  company: string;
  url: string;
  jobDescription: string;
  jobType: JobType;
  location?: string;
  recruiterName?: string;
  recruiterProfileUrl?: string;
  /** e.g. "Over 100 applicants" */
  applicants?: string;
  /** e.g. "Posted 2 weeks ago" — raw text from source platform */
  posted?: string;
  /** Parsed calendar date when job was posted on the source platform */
  postedAt?: Date;
  /** @deprecated use applicants */
  linkedinApplicants?: string;
  /** @deprecated use posted */
  linkedinPosted?: string;
  source?:
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
  /** FAANG + MANGOES companies get email alerts and sort to top */
  priority?: 'faang' | 'standard';
  status: JobStatus;
  /** Overall resume↔JD match % (same basis as keyword coverage today). */
  matchScore?: number;
  /** Keyword coverage % = matched / total JD tech keywords. */
  keywordMatchScore?: number;
  matchedKeywords?: string[];
  missingKeywords?: string[];
  skillGaps?: string[];
  latexResume?: string;
  pdfPath?: string;
  recruiterMessageDraft?: string;
  notes?: string;
  /** 1–5 how excited you are about this role (Teal-style). */
  interest?: number;
  /** When to follow up (email / check portal). */
  followUpAt?: Date;
  /** When marked applied (for stale follow-up insights). */
  appliedAt?: Date;
  coverLetterDraft?: string;
  contactSuggestions?: ContactSuggestion[];
  pipelinePhase?: 'jobright' | 'linkedin' | 'career_portal';
  pendingAction: PendingAction;
  /** Step while resume is generating (shown in UI progress). */
  resumePhase?: ResumePhase;
  /** Step while career-page / ATS apply is running. */
  applyPhase?: ApplyPhase;
  /** Detected ATS for the apply URL (set when apply starts). */
  atsType?: AtsType;
  approvalNote?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const JobSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    company: { type: String, required: true },
    url: { type: String, required: true, unique: true },
    jobDescription: { type: String, required: true },
    jobType: { type: String, enum: ['internship', 'fulltime'], required: true },
    location: { type: String },
    recruiterName: { type: String },
    recruiterProfileUrl: { type: String },
    applicants: { type: String },
    posted: { type: String },
    postedAt: { type: Date },
    linkedinApplicants: { type: String },
    linkedinPosted: { type: String },
    source: {
      type: String,
      enum: [
        'jobright',
        'linkedin',
        'indeed',
        'career_portal',
        'greenhouse',
        'lever',
        'github',
        'simplify',
        'scoutify',
        'company_portal',
        'other',
      ],
      default: 'linkedin',
    },
    priority: { type: String, enum: ['faang', 'standard'], default: 'standard' },
    status: {
      type: String,
      enum: [
        'scraped',
        'resume_generating',
        'resume_generated',
        'pending_resume_approval',
        'pdf_uploaded',
        'applying',
        'pending_message_approval',
        'pending_submit_approval',
        'applied',
        'assessment',
        'interview',
        'confused_hold',
        'invalid_job',
        'accepted',
        'failed',
      ],
      default: 'scraped',
    },
    matchScore: { type: Number },
    keywordMatchScore: { type: Number },
    matchedKeywords: [{ type: String }],
    missingKeywords: [{ type: String }],
    skillGaps: [{ type: String }],
    latexResume: { type: String },
    pdfPath: { type: String },
    recruiterMessageDraft: { type: String },
    coverLetterDraft: { type: String },
    notes: { type: String, default: '' },
    interest: { type: Number, min: 1, max: 5 },
    followUpAt: { type: Date },
    appliedAt: { type: Date },
    contactSuggestions: [
      {
        name: { type: String },
        title: { type: String },
        linkedinSearchQuery: { type: String },
        notes: { type: String },
      },
    ],
    pipelinePhase: {
      type: String,
      enum: ['jobright', 'linkedin', 'career_portal'],
    },
    pendingAction: {
      type: String,
      enum: ['resume_review', 'message_send', 'submit_application', null],
      default: null,
    },
    resumePhase: {
      type: String,
      enum: [
        'idle',
        'saving_jd',
        'generating',
        'compiling',
        'checking_match',
        'repairing_match',
        'done',
        'failed',
      ],
      default: 'idle',
    },
    applyPhase: {
      type: String,
      enum: [
        'idle',
        'opening',
        'filling',
        'uploading',
        'awaiting_submit',
        'submitting',
        'done',
        'failed',
        'confused_hold',
      ],
      default: 'idle',
    },
    atsType: {
      type: String,
      enum: ['greenhouse', 'lever', 'ashby', 'workday', 'linkedin', 'indeed', 'unknown'],
    },
    approvalNote: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IJob>('Job', JobSchema);
