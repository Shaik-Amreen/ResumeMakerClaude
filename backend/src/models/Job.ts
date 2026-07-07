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
  | 'failed';

export type PendingAction = 'resume_review' | 'message_send' | 'submit_application' | null;

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
  source?: 'jobright' | 'linkedin' | 'indeed' | 'career_portal' | 'other';
  /** FAANG + MANGOES companies get email alerts and sort to top */
  priority?: 'faang' | 'standard';
  status: JobStatus;
  matchScore?: number;
  latexResume?: string;
  pdfPath?: string;
  recruiterMessageDraft?: string;
  pendingAction: PendingAction;
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
      enum: ['jobright', 'linkedin', 'indeed', 'career_portal', 'other'],
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
        'failed',
      ],
      default: 'scraped',
    },
    matchScore: { type: Number },
    latexResume: { type: String },
    pdfPath: { type: String },
    recruiterMessageDraft: { type: String },
    pendingAction: {
      type: String,
      enum: ['resume_review', 'message_send', 'submit_application', null],
      default: null,
    },
    approvalNote: { type: String },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IJob>('Job', JobSchema);
