/** Status chips + labels used across list + detail. */

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
    pending_submit_approval: 'Approve submit',
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
