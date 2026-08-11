import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquare,
  Send,
  AlertTriangle,
} from 'lucide-react';
import type { Job } from '../types';
import { detectAtsUi, ATS_BADGE_CLASS, isCareerApplyUrl } from '../utils/atsUi';
import { statusLabel } from '../utils/statusUi';

interface Props {
  job: Job;
  busy: boolean;
  onApproveResume: () => void;
  onApproveAndApply: () => void;
  onApply: () => void;
  onRetry: () => void;
  onApproveMessage: () => void;
  onApproveSubmit: () => void;
  onOpenLink: () => void;
}

/**
 * Sticky apply rail — primary career-page actions stay visible while reviewing PDF/JD.
 */
export function ApplyWorkflowBanner({
  job,
  busy,
  onApproveResume,
  onApproveAndApply,
  onApply,
  onRetry,
  onApproveMessage,
  onApproveSubmit,
  onOpenLink,
}: Props) {
  const ats = detectAtsUi(job.url, job.source, job.atsType);
  const career = isCareerApplyUrl(job.url) && job.priority !== 'faang';
  const phase = job.applyPhase && job.applyPhase !== 'idle' ? job.applyPhase : null;

  const showApproveResume = job.status === 'pending_resume_approval' && Boolean(job.pdfPath);
  const showCareerApply =
    career &&
    Boolean(job.pdfPath) &&
    (job.status === 'pdf_uploaded' || job.status === 'pending_resume_approval');
  const showLinkedIn =
    !isCareerApplyUrl(job.url) &&
    job.priority !== 'faang' &&
    Boolean(job.pdfPath) &&
    (job.status === 'pdf_uploaded' || job.status === 'pending_resume_approval');
  const showRetry =
    career &&
    Boolean(job.pdfPath) &&
    (job.status === 'confused_hold' || job.status === 'failed');
  const showMessage = job.status === 'pending_message_approval';
  const showSubmit = job.status === 'pending_submit_approval';
  const applying = job.status === 'applying' || phase === 'filling' || phase === 'uploading';

  if (
    !showApproveResume &&
    !showCareerApply &&
    !showLinkedIn &&
    !showRetry &&
    !showMessage &&
    !showSubmit &&
    !applying &&
    job.priority !== 'faang'
  ) {
    return null;
  }

  return (
    <div className="sticky top-0 z-20 toolbar border-b border-white/40">
      <div className="px-4 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span
              className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ATS_BADGE_CLASS[ats.kind]}`}
            >
              {ats.label}
            </span>
            <span className="text-[11px] font-semibold text-ink-muted capitalize">
              {statusLabel(job.status)}
              {phase ? ` · ${phase.replace(/_/g, ' ')}` : ''}
            </span>
            {job.priority === 'faang' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-900 bg-amber-50 border border-amber-200/80 px-2.5 py-0.5 rounded-full">
                <AlertTriangle size={11} /> Manual apply only
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onOpenLink}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-cedar hover:text-cedar-ink transition-colors duration-300 ease-apple"
          >
            Open job <ExternalLink size={12} />
          </button>
        </div>

        {showSubmit && (
          <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/90 px-3.5 py-3 flex flex-wrap items-center justify-between gap-2 animate-pulse-soft shadow-soft">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-emerald-950 font-display">
                Final step — review Chrome, then submit
              </p>
              <p className="text-[11px] text-emerald-900/80 mt-0.5 leading-relaxed">
                Look at the <span className="font-semibold">automation Chrome</span> window (port 9333), not your
                normal browser. If you only see Jobright/blank, click Show form in Chrome.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onOpenLink}
                className="btn-secondary inline-flex items-center gap-1.5 !text-emerald-900"
              >
                <ExternalLink size={13} />
                Show form in Chrome
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onApproveSubmit}
                className="btn-primary inline-flex items-center gap-2 !bg-emerald-700 hover:!bg-emerald-800"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Approve Submit
              </button>
            </div>
          </div>
        )}

        {showMessage && (
          <div className="rounded-2xl border border-amber-200/90 bg-amber-50/90 px-3.5 py-3 flex flex-wrap items-center justify-between gap-2 shadow-soft animate-slide-down">
            <p className="text-xs font-bold text-amber-950 font-display">
              LinkedIn message waiting for approval
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={onApproveMessage}
              className="btn-secondary inline-flex items-center gap-2 !border-amber-300 !bg-amber-100 !text-amber-950"
            >
              <MessageSquare size={14} /> Approve Message
            </button>
          </div>
        )}

        {applying && !showSubmit && (
          <div className="rounded-2xl border border-cedar/20 bg-cedar-soft/80 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-cedar-ink shadow-soft animate-slide-down">
            <Loader2 size={14} className="animate-spin text-cedar" />
            Filling career form in Chrome — leave the window open.
          </div>
        )}

        {(showApproveResume || showCareerApply || showLinkedIn || showRetry) && !showSubmit && (
          <div className="flex flex-wrap gap-2">
            {showApproveResume && (
              <button
                type="button"
                disabled={busy}
                onClick={onApproveResume}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <CheckCircle2 size={14} /> Approve Resume
              </button>
            )}
            {showCareerApply && (
              <button
                type="button"
                disabled={busy}
                onClick={job.status === 'pending_resume_approval' ? onApproveAndApply : onApply}
                className="btn-primary inline-flex items-center gap-2"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {job.status === 'pending_resume_approval'
                  ? 'Approve & Apply (Career)'
                  : 'Apply on Career Page'}
              </button>
            )}
            {showLinkedIn && (
              <button
                type="button"
                disabled={busy}
                onClick={job.status === 'pending_resume_approval' ? onApproveAndApply : onApply}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <Send size={14} />
                {job.status === 'pending_resume_approval' ? 'Approve & Easy Apply' : 'Easy Apply'}
              </button>
            )}
            {showRetry && (
              <button
                type="button"
                disabled={busy}
                onClick={onRetry}
                className="btn-warn inline-flex items-center gap-2"
              >
                <Send size={14} /> Retry Career Apply
              </button>
            )}
          </div>
        )}

        {!showSubmit && job.priority !== 'faang' && (showCareerApply || showLinkedIn || showApproveResume) && (
          <p className="text-[10px] text-ink-faint leading-relaxed">
            Two apply paths: <span className="font-semibold text-ink-muted">Apply on Career Page</span>{' '}
            uses automation Chrome (port 9333). Or open the job in your normal browser → Simplify fill
            → extension <span className="font-semibold text-ink-muted">Attach resume</span> → you Submit.
          </p>
        )}
        {job.priority === 'faang' && (
          <p className="text-[11px] text-amber-900/90">
            FAANG/MANGO roles stay manual — open the company site with your tailored PDF.
          </p>
        )}
      </div>
    </div>
  );
}
