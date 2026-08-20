/** Status chips + labels used across list + detail. */

import type { ApplyPhase, JobStatus } from '../types';

export const STATUS_STYLES: Record<string, string> = {
  scraped: 'bg-slate-100 text-slate-700 border border-slate-200',
  resume_generating: 'bg-cedar-soft text-cedar-ink border border-cedar/20',
  resume_generated: 'bg-amber-50 text-amber-900 border border-amber-200',
  pending_resume_approval: 'bg-amber-100 text-amber-950 border border-amber-300',
  pdf_uploaded: 'bg-sky-50 text-sky-900 border border-sky-200',
  applying: 'bg-cedar/15 text-cedar-ink border border-cedar/30',
  pending_message_approval: 'bg-orange-50 text-orange-950 border border-orange-200',
  pending_submit_approval: 'bg-emerald-100 text-emerald-950 border border-emerald-300 ring-1 ring-emerald-400/40',
  applied: 'bg-emerald-50 text-emerald-900 border border-emerald-200',
  assessment: 'bg-cyan-50 text-cyan-950 border border-cyan-200',
  interview: 'bg-blue-50 text-blue-950 border border-blue-200',
  confused_hold: 'bg-amber-50 text-amber-950 border border-amber-300',
  invalid_job: 'bg-rose-50 text-rose-950 border border-rose-200',
  accepted: 'bg-lime-50 text-lime-950 border border-lime-300',
  failed: 'bg-red-50 text-red-900 border border-red-200',
};

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    confused_hold: 'Needs you',
    invalid_job: 'Invalid job',
    assessment: 'Assessment',
    interview: 'Interview',
    accepted: 'Accepted',
    pending_resume_approval: 'Review resume',
    pending_submit_approval: 'Ready to mark',
    pending_message_approval: 'Approve message',
    resume_generating: 'Generating…',
    resume_generated: 'Resume ready',
    pdf_uploaded: 'Ready to apply',
    applying: 'Applying…',
    applied: 'Applied',
    scraped: 'Scraped',
    failed: 'Failed',
  };
  return labels[status] || status.replace(/_/g, ' ');
}

export function needsUserAttention(status: string, pendingAction?: string | null): boolean {
  return (
    status === 'pending_submit_approval' ||
    status === 'pending_resume_approval' ||
    status === 'pending_message_approval' ||
    status === 'confused_hold' ||
    Boolean(pendingAction)
  );
}

/** Statuses the user can set from the job detail dropdown. */
export const MANUAL_STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: 'scraped', label: 'Scraped' },
  { value: 'resume_generated', label: 'Resume generated' },
  { value: 'pdf_uploaded', label: 'PDF uploaded' },
  { value: 'applied', label: 'Applied' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'interview', label: 'Interview' },
  { value: 'confused_hold', label: 'Confused - Hold' },
  { value: 'invalid_job', label: 'Invalid job' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'failed', label: 'Failed / Skipped' },
];

/** Pipeline-owned statuses (shown as current only, not direct set targets). */
export const PIPELINE_ONLY_STATUSES: JobStatus[] = [
  'resume_generating',
  'pending_resume_approval',
  'applying',
  'pending_message_approval',
  'pending_submit_approval',
];

export function isManualStatus(status: string): boolean {
  return MANUAL_STATUS_OPTIONS.some((s) => s.value === status);
}

export function statusDropdownOptions(currentStatus: JobStatus): { value: JobStatus; label: string }[] {
  const options: { value: JobStatus; label: string }[] = [];
  if (PIPELINE_ONLY_STATUSES.includes(currentStatus)) {
    options.push({
      value: currentStatus,
      label: `${statusLabel(currentStatus)} (current)`,
    });
  }
  options.push(...MANUAL_STATUS_OPTIONS);
  return options;
}

/** Hide stale applyPhase tags (e.g. confused_hold after resume clear → scraped). */
export function shouldShowApplyPhaseBanner(job: {
  status: JobStatus;
  applyPhase?: ApplyPhase | null;
}): boolean {
  const phase = job.applyPhase;
  if (!phase || phase === 'idle' || phase === 'done') return false;
  if (phase === 'confused_hold') return job.status === 'confused_hold';
  if (
    job.status === 'applying' ||
    job.status === 'pending_submit_approval' ||
    job.status === 'pending_message_approval'
  ) {
    return true;
  }
  return false;
}
