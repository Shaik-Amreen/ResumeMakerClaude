import { useEffect, useState } from 'react';
import { toast as reactToast } from 'react-toastify';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Users,
  Clock,
  Globe,
  Trash2,
  FileCode2,
  FileText,
  Pencil,
  Save,
  Download,
  Copy,
} from 'lucide-react';
import type { Job, JobStatus, ResumePhase } from '../types';
import { api, UPLOADS_BASE } from '../api';
import { jobApplicants, formatPostedOnPlatform, formatScrapedOn } from '../utils/jobFilters';
import { useConfirm } from './ConfirmProvider';
import { ApplyWorkflowBanner } from './ApplyWorkflowBanner';
import { detectAtsUi, ATS_BADGE_CLASS } from '../utils/atsUi';
import { statusLabel, MANUAL_STATUS_OPTIONS, statusDropdownOptions, shouldShowApplyPhaseBanner } from '../utils/statusUi';

function isLinkedInJobUrl(url: string): boolean {
  return /linkedin\.com\/(jobs|job)/i.test(url);
}

function canCareerApply(job: Job): boolean {
  return (
    job.priority !== 'faang' &&
    Boolean(job.pdfPath) &&
    !isLinkedInJobUrl(job.url)
  );
}

/** Safe download name: Karthik-{title} with {company}.pdf */
function resumeDownloadFilename(title: string, company: string): string {
  const clean = (s: string) =>
    (s || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  const t = clean(title) || 'Resume';
  const c = clean(company) || 'Company';
  return `Karthik-${t} with ${c}.pdf`;
}

function coverLetterDownloadFilename(company: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const mon = MONTHS[now.getMonth()] || 'Jan';
  const yy = String(now.getFullYear()).slice(-2);
  const clean = (s: string) =>
    (s || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, 40);
  const c = clean(company);
  return c
    ? `Karthik_Kovi_Cover_Letter_${c}_${mon}${yy}.pdf`
    : `Karthik_Kovi_Cover_Letter_${mon}${yy}.pdf`;
}

const RESUME_STEPS: { id: ResumePhase; label: string }[] = [
  { id: 'saving_jd', label: 'Saving JD' },
  { id: 'generating', label: 'Generating resume' },
  { id: 'compiling', label: 'Compiling PDF' },
  { id: 'checking_match', label: 'Checking keyword match' },
  { id: 'repairing_match', label: 'Repairing skill gaps' },
  { id: 'done', label: 'Done' },
];

function stepIndex(phase?: ResumePhase | null): number {
  if (!phase || phase === 'idle') return -1;
  if (phase === 'failed') return -2;
  return RESUME_STEPS.findIndex((s) => s.id === phase);
}


interface Props {
  job: Job;
  onUpdated: () => void;
  onDeleted?: () => void;
  /** Called after a human gate is cleared so the parent can jump to the next queue item. */
  onGateComplete?: (jobId: string) => void;
}

export function JobDetailPanel({ job, onUpdated, onDeleted, onGateComplete }: Props) {
  const [statusSelectKey, setStatusSelectKey] = useState(0);
  const confirm = useConfirm();
  const [current, setCurrent] = useState(job);
  const [messageDraft, setMessageDraft] = useState(job.recruiterMessageDraft || '');
  const [coverLetterDraft, setCoverLetterDraft] = useState(job.coverLetterDraft || '');
  const [notesDraft, setNotesDraft] = useState(job.notes || '');
  const [interest, setInterest] = useState(job.interest || 0);
  const [followUpAt, setFollowUpAt] = useState(
    job.followUpAt ? job.followUpAt.slice(0, 10) : ''
  );
  const [latexDraft, setLatexDraft] = useState(job.latexResume || '');
  const [latexDirty, setLatexDirty] = useState(false);
  const [jdDraft, setJdDraft] = useState(job.jobDescription || '');
  const [editingJd, setEditingJd] = useState(false);
  const [jdDirty, setJdDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recompiling, setRecompiling] = useState(false);
  const [toast, setToast] = useState('');
  const [pdfNonce, setPdfNonce] = useState(0);

  useEffect(() => {
    setStatusSelectKey((k) => k + 1);
  }, [job._id, job.status]);

  useEffect(() => {
    setCurrent(job);
    setMessageDraft(job.recruiterMessageDraft || '');
    setCoverLetterDraft(job.coverLetterDraft || '');
    setNotesDraft(job.notes || '');
    setInterest(job.interest || 0);
    setFollowUpAt(job.followUpAt ? job.followUpAt.slice(0, 10) : '');
    // Don't clobber in-progress editor edits on poll refresh.
    if (!latexDirty) {
      setLatexDraft(job.latexResume || '');
    }
    if (!editingJd || !jdDirty) {
      setJdDraft(job.jobDescription || '');
    }
  }, [job, latexDirty, editingJd, jdDirty]);

  useEffect(() => {
    setLatexDirty(false);
    setLatexDraft(job.latexResume || '');
    setEditingJd(false);
    setJdDirty(false);
    setJdDraft(job.jobDescription || '');
    setPdfNonce((n) => n + 1);
  }, [job._id]);

  // Fast-poll while generating so Edit JD → Save & regenerate shows live steps.
  useEffect(() => {
    const generating =
      current.status === 'resume_generating' ||
      current.resumePhase === 'saving_jd' ||
      current.resumePhase === 'generating' ||
      current.resumePhase === 'compiling' ||
      current.resumePhase === 'checking_match' ||
      current.resumePhase === 'repairing_match';
    if (!generating) return;

    let cancelled = false;
    let lastPhase = current.resumePhase;
    let lastStatus = current.status;
    const tick = async () => {
      try {
        const refreshed = await api.getJob(current._id);
        if (cancelled) return;
        setCurrent(refreshed);
        if (!latexDirty) setLatexDraft(refreshed.latexResume || '');
        if (refreshed.pdfUrl) setPdfNonce((n) => n + 1);
        if (refreshed.resumePhase !== lastPhase || refreshed.status !== lastStatus) {
          lastPhase = refreshed.resumePhase;
          lastStatus = refreshed.status;
          onUpdated();
        }
      } catch {
        // ignore transient poll errors
      }
    };
    const id = window.setInterval(tick, 2000);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll only while this job is generating
  }, [current._id, current.status, current.resumePhase, latexDirty]);

  const run = async (
    fn: () => Promise<unknown>,
    successMsg: string,
    opts?: { advance?: boolean; pickJob?: (result: unknown) => Job | null | undefined }
  ) => {
    setBusy(true);
    setToast('');
    try {
      const result = await fn();
      const picked = opts?.pickJob?.(result);
      if (picked) {
        setCurrent(picked);
      } else if (!opts?.advance) {
        const refreshed = await api.getJob(current._id);
        setCurrent(refreshed);
      }
      setToast(successMsg);
      reactToast.success(successMsg);
      onUpdated();
      if (opts?.advance) {
        onGateComplete?.(current._id);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Action failed';
      setToast(errMsg);
      reactToast.error(errMsg);
    } finally {
      setBusy(false);
    }
  };

  const markAppliedConfirmed = async (): Promise<boolean> => {
    const ok = await confirm({
      title: 'Mark as applied?',
      message: (
        <div className="space-y-2">
          <p className="font-semibold text-ink">
            {current.title} @ {current.company}
          </p>
          <p className="text-xs text-ink-muted">
            Only do this after you submitted on the company site. This updates tracker status only —
            it does not click Submit for you.
          </p>
        </div>
      ),
      confirmText: 'Mark applied',
      cancelText: 'Cancel',
      variant: 'primary',
    });
    if (!ok) return false;
    await run(() => api.updateStatus(current._id, 'applied'), 'Marked applied', {
      advance: true,
      pickJob: (r) => r as Job,
    });
    return true;
  };

  const statusOptions = statusDropdownOptions(current.status);

  const copyJd = async () => {
    try {
      await navigator.clipboard.writeText(editingJd ? jdDraft : current.jobDescription);
      setToast('Job description copied to clipboard');
    } catch {
      reactToast.error('Could not copy: select text manually');
    }
  };

  const copyApplicationLink = async () => {
    const url = String(current.url || '').trim();
    if (!url) {
      reactToast.error('No application link for this job');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      reactToast.success('Application link copied');
      setToast('Application link copied');
    } catch {
      reactToast.error('Could not copy link');
    }
  };

  const saveJdAndRegenerate = async () => {
    const text = jdDraft.trim();
    if (text.length < 40) {
      setToast('JD must be at least 40 characters');
      return;
    }
    setBusy(true);
    setToast('');
    try {
      const { job: updated, message } = await api.updateJobDescription(current._id, text, true);
      setCurrent(updated);
      setJdDraft(updated.jobDescription);
      setEditingJd(false);
      setJdDirty(false);
      setToast(message);
      onUpdated();
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to save JD');
    } finally {
      setBusy(false);
    }
  };

  const recompile = async () => {
    if (!latexDraft.trim()) {
      setToast('Paste or generate LaTeX first');
      return;
    }
    setRecompiling(true);
    setBusy(true);
    setToast('');
    try {
      const { job: updated, warning, pageCount } = await api.submitLatex(current._id, latexDraft);
      setCurrent(updated);
      setLatexDraft(updated.latexResume || latexDraft);
      setLatexDirty(false);
      setPdfNonce((n) => n + 1);
      onUpdated();
      if (warning) {
        setToast(warning);
      } else {
        setToast(
          pageCount
            ? `Recompiled: PDF updated (${pageCount} page${pageCount === 1 ? '' : 's'})`
            : 'Recompiled: PDF updated from your LaTeX'
        );
      }
    } catch (e) {
      // Still refresh in case LaTeX was saved
      try {
        const refreshed = await api.getJob(current._id);
        setCurrent(refreshed);
        if (refreshed.pdfUrl) setPdfNonce((n) => n + 1);
      } catch {
        // ignore
      }
      setToast(e instanceof Error ? e.message : 'Recompile failed');
    } finally {
      setRecompiling(false);
      setBusy(false);
    }
  };

  const applicants = jobApplicants(current);
  const postedLabel = formatPostedOnPlatform(current);
  const scrapedLabel = formatScrapedOn(current);
  const pdfPreviewUrl = current.pdfUrl
    ? `${UPLOADS_BASE}${current.pdfUrl}?v=${encodeURIComponent(current.updatedAt || '')}-${pdfNonce}`
    : null;

  const downloadResume = async () => {
    if (!current.pdfUrl) return;
    try {
      const res = await fetch(`${UPLOADS_BASE}${current.pdfUrl}`);
      if (!res.ok) throw new Error('Could not fetch PDF');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = resumeDownloadFilename(current.title, current.company);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const downloadCoverLetter = async () => {
    const text = coverLetterDraft.trim();
    if (!text) {
      reactToast.info('Generate or paste a cover letter first');
      return;
    }
    try {
      // Persist draft so PDF matches what you see
      if (text !== (current.coverLetterDraft || '').trim()) {
        const saved = await api.updateWorkspace(current._id, { coverLetterDraft: text });
        setCurrent(saved);
      }
      const res = await fetch(`${UPLOADS_BASE}/api/jobs/${current._id}/cover-letter.pdf`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Could not build cover letter PDF');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = coverLetterDownloadFilename(current.company);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      reactToast.success('Cover letter PDF downloaded');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Download failed';
      setToast(msg);
      reactToast.error(msg);
    }
  };

  const resumeMatch = current.matchScore ?? current.keywordMatchScore;
  const keywordMatch = current.keywordMatchScore ?? current.matchScore;
  const matched = current.matchedKeywords || [];
  const missing = current.missingKeywords || [];
  const skillGaps = current.skillGaps || [];
  const keywordTotal = matched.length + missing.length;
  const activeStep = stepIndex(current.resumePhase);
  const isGenerating =
    current.status === 'resume_generating' ||
    ['saving_jd', 'generating', 'compiling', 'checking_match', 'repairing_match'].includes(
      current.resumePhase || ''
    );

  const refreshScores = async () => {
    if (!current.latexResume?.trim() && !latexDraft.trim()) {
      setToast('Generate or paste LaTeX first');
      return;
    }
    setBusy(true);
    setToast('');
    try {
      // Persist draft LaTeX first if dirty so score reflects editor
      if (latexDirty && latexDraft.trim()) {
        const { job: updated } = await api.submitLatex(current._id, latexDraft);
        setCurrent(updated);
        setLatexDraft(updated.latexResume || latexDraft);
        setLatexDirty(false);
        setPdfNonce((n) => n + 1);
        onUpdated();
        setToast(
          `Scores updated: resume ${updated.matchScore ?? '—'}% · keywords ${updated.keywordMatchScore ?? '—'}%`
        );
      } else {
        const result = await api.refreshMatchScore(current._id);
        setCurrent(result.job);
        onUpdated();
        setToast(
          `Scores updated: resume ${result.resumeMatchScore}% · keywords ${result.keywordMatchScore}%`
        );
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not score resume');
    } finally {
      setBusy(false);
    }
  };

  const scoreColor = (n?: number | null) => {
    if (n == null) return 'text-ink-muted border-slate-200 bg-slate-50';
    if (n >= 95) return 'text-emerald-800 border-emerald-200 bg-emerald-50';
    if (n >= 75) return 'text-amber-900 border-amber-200 bg-amber-50';
    return 'text-red-800 border-red-200 bg-red-50';
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ApplyWorkflowBanner
        job={current}
        busy={busy}
        onApproveResume={() =>
          run(() => api.approveResume(current._id), 'Resume approved — next in queue', {
            advance: true,
          })
        }
        onApproveAndApply={() =>
          run(
            () => api.approveResumeAndApply(current._id).then((r) => r.message),
            canCareerApply(current)
              ? 'Career apply started — approve Submit when ready'
              : 'Easy Apply started — approve before Submit'
          )
        }
        onApply={() =>
          run(
            () => api.apply(current._id),
            canCareerApply(current) ? 'Career-page apply started' : 'LinkedIn Easy Apply started'
          )
        }
        onRetry={() => run(() => api.apply(current._id), 'Retrying career-page apply')}
        onApproveMessage={() =>
          run(() => api.approveMessage(current._id, messageDraft), 'Message approved — next', {
            advance: true,
          })
        }
        onMarkApplied={() => void markAppliedConfirmed()}
        onOpenLink={() => {
          window.open(current.url, '_blank', 'noopener,noreferrer');
        }}
      />

      <div className="px-4 py-5 border-b border-paper-line/80 bg-gradient-to-b from-cedar-soft/45 to-transparent shrink-0">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <p className="section-label text-cedar">
            {current.jobType} · {statusLabel(current.status)}
          </p>
          {(() => {
            const ats = detectAtsUi(current.url, current.source, current.atsType);
            return (
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-bold border ${ATS_BADGE_CLASS[ats.kind]}`}
              >
                {ats.label}
              </span>
            );
          })()}
          {resumeMatch != null && (
            <span className="text-[11px] font-semibold text-ink-muted">Resume {resumeMatch}%</span>
          )}
          {keywordMatch != null && (
            <span className="text-[11px] font-semibold text-ink-muted">Keywords {keywordMatch}%</span>
          )}
        </div>
        <h2 className="text-[1.65rem] font-bold font-display text-ink tracking-tight leading-tight">
          {current.title}
        </h2>
        <p className="text-ink-muted mt-1.5 text-sm">
          {current.company}
          {current.location ? ` · ${current.location}` : ''}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-sm text-ink-muted">
          {postedLabel && (
            <span className="inline-flex items-center gap-1.5">
              <Clock size={15} className="text-cedar" />
              <span className="text-ink">{postedLabel}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Globe size={15} className="text-cedar/70" />
            <span className="text-ink">
              <span className="text-ink-faint">Scraped: </span>
              {scrapedLabel.replace(/^Scraped on\s+/i, '')}
            </span>
          </span>
          {applicants && (
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} className="text-amber-600" />
              {applicants}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <select
            key={statusSelectKey}
            value={current.status}
            disabled={busy}
            onChange={async (e) => {
              const next = e.target.value as JobStatus;
              if (next === current.status) return;

              if (next === 'applied') {
                const ok = await markAppliedConfirmed();
                if (!ok) setStatusSelectKey((k) => k + 1);
                return;
              }

              const destructive = next === 'failed' || next === 'invalid_job';
              if (destructive) {
                const ok = await confirm({
                  title: `Set status to ${MANUAL_STATUS_OPTIONS.find((s) => s.value === next)?.label ?? next}?`,
                  message: (
                    <p className="text-xs text-ink-muted">
                      {current.title} @ {current.company}
                    </p>
                  ),
                  confirmText: 'Update status',
                  cancelText: 'Cancel',
                  variant: next === 'failed' ? 'danger' : 'warning',
                });
                if (!ok) {
                  setStatusSelectKey((k) => k + 1);
                  return;
                }
              }

              await run(() => api.updateStatus(current._id, next), 'Status updated', {
                pickJob: (r) => r as Job,
              });
            }}
            className="rounded-xl bg-white border border-paper-line px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:border-cedar focus:ring-2 focus:ring-cedar/15"
            aria-label="Job status"
          >
            {statusOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {!['applied', 'assessment', 'interview', 'accepted'].includes(current.status) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void markAppliedConfirmed()}
              className="btn-primary inline-flex items-center gap-2"
            >
              <CheckCircle2 size={15} /> Mark applied
            </button>
          )}

          <button
            type="button"
            onClick={() => void copyApplicationLink()}
            className="btn-secondary inline-flex items-center gap-2"
            title={current.url || 'No application link'}
          >
            <Copy size={15} /> Copy application link
          </button>

          <button
            type="button"
            onClick={copyJd}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Copy size={15} /> Copy JD
          </button>

          <button
            type="button"
            disabled={busy || current.status === 'resume_generating'}
            onClick={() =>
              run(
                () => api.generateResumeOllama(current._id),
                `Resume generation started: check LaTeX/PDF in 1–3 minutes`
              )
            }
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-40"
          >
            Generate Resume
          </button>

          <label className="btn-secondary inline-flex items-center gap-2 cursor-pointer">
            <Upload size={15} /> Upload PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) run(() => api.uploadPdf(current._id, file), 'PDF uploaded: review and approve');
              }}
            />
          </label>

          {current.pdfUrl && (
            <button
              type="button"
              onClick={() => void downloadResume()}
              className="btn-secondary inline-flex items-center gap-2 !border-emerald-300 !bg-emerald-50 !text-emerald-900"
            >
              <Download size={15} /> Download Resume
            </button>
          )}

          <button
            type="button"
            disabled={busy || !coverLetterDraft.trim()}
            onClick={() => void downloadCoverLetter()}
            className="btn-secondary inline-flex items-center gap-2 !border-sky-300 !bg-sky-50 !text-sky-950 disabled:opacity-40"
            title={
              coverLetterDraft.trim()
                ? 'Download cover letter PDF for Additional Attachments'
                : 'Generate cover letter first'
            }
          >
            <Download size={15} /> Download Cover Letter
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete this job?',
                message: (
                  <div className="space-y-2">
                    <p className="font-semibold text-ink">{current.title} @ {current.company}</p>
                    <p className="text-xs text-ink-muted">This removes the listing and any resume PDF/TeX files.</p>
                  </div>
                ),
                confirmText: 'Delete Job',
                variant: 'danger',
              });
              if (!ok) return;

              setBusy(true);
              setToast('');
              try {
                const r = await api.deleteJob(current._id);
                setToast(r.message);
                reactToast.success(r.message || 'Job deleted');
                onDeleted?.();
                onUpdated();
              } catch (e) {
                const errMsg = e instanceof Error ? e.message : 'Delete failed';
                setToast(errMsg);
                reactToast.error(errMsg);
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 text-sm text-red-800 disabled:opacity-40"
          >
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 bg-paper-card">
        {current.approvalNote && (
          <div className="border border-cedar/25 bg-cedar-soft/80 rounded-xl px-3 py-3 text-sm text-cedar-ink">
            {current.approvalNote.replace(/\s*—\s*/g, ' • ').replace(/—/g, ' - ')}
            {shouldShowApplyPhaseBanner(current) && (
              <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-cedar">
                [{current.applyPhase!.replace(/_/g, ' ')}
                {current.atsType ? ` · ${current.atsType}` : ''}]
              </span>
            )}
          </div>
        )}

        {(isGenerating || current.resumePhase === 'done' || current.resumePhase === 'failed') && (
          <section className="border border-slate-200/80 rounded-2xl bg-slate-50/70 p-3.5 shadow-2xs">
            <div className="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-200/60">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {isGenerating ? 'Resume Generation Progress' : 'Generation Steps'}
              </h3>
              {isGenerating && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                  <Loader2 size={11} className="animate-spin text-violet-600" />
                  Live Step
                </span>
              )}
            </div>
            <ul className="space-y-1">
              {RESUME_STEPS.map((step, i) => {
                const isFailedPhase = current.resumePhase === 'failed';
                const isDonePhase = current.resumePhase === 'done';

                let status: 'completed' | 'active' | 'failed' | 'pending' = 'pending';
                if (isDonePhase) {
                  status = 'completed';
                } else if (isFailedPhase) {
                  const failedIdx = activeStep >= 0 ? activeStep : current.pdfUrl ? 5 : 2;
                  if (i < failedIdx) status = 'completed';
                  else if (i === failedIdx) status = 'failed';
                  else status = 'pending';
                } else if (activeStep >= 0) {
                  if (i < activeStep) status = 'completed';
                  else if (i === activeStep) status = 'active';
                  else status = 'pending';
                }

                return (
                  <li
                    key={step.id}
                    className={`flex items-center justify-between gap-3 py-1.5 px-2.5 rounded-xl transition-all ${
                      status === 'active'
                        ? 'bg-violet-100/70 border border-violet-200/80'
                        : status === 'completed'
                          ? 'hover:bg-emerald-50/50'
                          : status === 'failed'
                            ? 'bg-red-50/80 border border-red-200/80'
                            : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {status === 'completed' && (
                        <CheckCircle2 size={17} className="text-emerald-600 shrink-0 fill-emerald-100" />
                      )}
                      {status === 'active' && (
                        <Loader2 size={17} className="text-violet-600 animate-spin shrink-0" />
                      )}
                      {status === 'failed' && (
                        <AlertCircle size={17} className="text-red-600 shrink-0 fill-red-100" />
                      )}
                      {status === 'pending' && (
                        <span className="h-4.5 w-4.5 rounded-full bg-white border border-slate-300 text-slate-400 text-[10px] font-bold flex items-center justify-center shrink-0 shadow-2xs">
                          {i + 1}
                        </span>
                      )}

                      <div className="min-w-0">
                        <p
                          className={`text-xs ${
                            status === 'completed'
                              ? 'text-emerald-950 font-semibold'
                              : status === 'active'
                                ? 'text-violet-950 font-bold'
                                : status === 'failed'
                                  ? 'text-red-950 font-semibold'
                                  : 'text-slate-500 font-medium'
                          }`}
                        >
                          {step.label}
                          {status === 'completed' && step.id === 'checking_match' && keywordMatch != null && (
                            <span className="ml-1.5 text-[11px] font-medium text-emerald-700">
                              ({keywordMatch}% match)
                            </span>
                          )}
                          {status === 'active' && step.id === 'checking_match' && keywordMatch != null && (
                            <span className="ml-1.5 text-[11px] font-medium text-violet-700">
                              ({keywordMatch}%)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div>
                      {status === 'completed' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100/90 text-emerald-800 border border-emerald-200/80">
                          Done
                        </span>
                      )}
                      {status === 'active' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-200/80 text-violet-900 border border-violet-300/80">
                          In Progress
                        </span>
                      )}
                      {status === 'failed' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800 border border-red-200">
                          Failed
                        </span>
                      )}
                      {status === 'pending' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-400">
                          Pending
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {current.resumePhase === 'failed' && (
              <p className="mt-2 text-xs text-red-700 font-medium bg-red-50 p-2 rounded-xl border border-red-200/80">
                Generation stopped: check error note below and edit JD / regenerate.
              </p>
            )}
          </section>
        )}

        {current.errorMessage && (
          <div className="border border-red-200 bg-red-50 rounded-xl px-3 py-3 text-sm text-red-800 flex gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            {current.errorMessage}
          </div>
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
              <FileText size={16} className="text-primary-500" />
              Job description
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyJd}
                className="text-xs text-primary-500 hover:text-primary-400 inline-flex items-center gap-1"
              >
                <Copy size={13} /> Copy
              </button>
              {!editingJd ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setJdDraft(current.jobDescription || '');
                    setEditingJd(true);
                    setJdDirty(false);
                  }}
                  className="text-xs text-violet-700 hover:text-violet-600 inline-flex items-center gap-1 disabled:opacity-40"
                >
                  <Pencil size={13} /> Edit JD
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingJd(false);
                      setJdDirty(false);
                      setJdDraft(current.jobDescription || '');
                    }}
                    className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || jdDraft.trim().length < 40}
                    onClick={saveJdAndRegenerate}
                    className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 px-2.5 py-1 rounded-lg inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <Save size={13} /> Save &amp; regenerate
                  </button>
                </>
              )}
            </div>
          </div>
          {editingJd ? (
            <div className="space-y-2">
              <textarea
                value={jdDraft}
                onChange={(e) => {
                  setJdDraft(e.target.value);
                  setJdDirty(true);
                }}
                rows={14}
                placeholder="Paste the full job description here…"
                className="w-full bg-white border border-violet-200 rounded-xl px-3 py-3 text-sm text-ink leading-relaxed focus:outline-none focus:ring-1 focus:ring-violet-300 resize-y min-h-[12rem]"
              />
              <p className="text-[11px] text-ink-faint">
                Saves the JD, then regenerates the resume so LaTeX/PDF match this description.
              </p>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm text-ink-muted max-h-[min(40vh,22rem)] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {current.jobDescription?.trim()
                ? current.jobDescription
                : 'No job description available for this listing.'}
            </div>
          )}
        </section>

        <section className="border border-slate-200 rounded-xl bg-gradient-to-r from-violet-50/70 to-emerald-50/50 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-ink">Match scores</h3>
            <button
              type="button"
              disabled={busy || (!current.latexResume && !latexDraft.trim())}
              onClick={refreshScores}
              className="text-xs text-violet-700 hover:text-violet-600 disabled:opacity-40"
            >
              Recalculate
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className={`rounded-lg border px-3 py-2 ${scoreColor(resumeMatch)}`}>
              <p className="text-[10px] uppercase tracking-wide opacity-80">Resume match</p>
              <p className="text-2xl font-bold tabular-nums">
                {resumeMatch != null ? `${resumeMatch}%` : '—'}
              </p>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${scoreColor(keywordMatch)}`}>
              <p className="text-[10px] uppercase tracking-wide opacity-80">Keyword match</p>
              <p className="text-2xl font-bold tabular-nums">
                {keywordMatch != null ? `${keywordMatch}%` : '—'}
              </p>
              {keywordTotal > 0 && (
                <p className="text-[11px] mt-0.5 opacity-80">
                  {matched.length}/{keywordTotal} covered
                </p>
              )}
            </div>
          </div>

          {(matched.length > 0 || missing.length > 0) && (
            <div className="mb-2">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <p className="text-[11px] font-medium text-ink">
                  JD keywords needed
                  {keywordTotal > 0 ? ` (${matched.length} matched · ${missing.length} missing)` : ''}
                </p>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="inline-flex items-center gap-1 text-emerald-800">
                    <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Matched
                  </span>
                  <span className="inline-flex items-center gap-1 text-red-800">
                    <span className="h-2 w-2 rounded-sm bg-red-500" /> Missing
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {matched.map((kw) => (
                  <span
                    key={`m-${kw}`}
                    className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-900 border border-emerald-300 font-medium"
                    title="Matched — evidenced on resume"
                  >
                    {kw}
                  </span>
                ))}
                {missing.map((kw) => (
                  <span
                    key={`x-${kw}`}
                    className="text-[11px] px-1.5 py-0.5 rounded-md bg-red-100 text-red-900 border border-red-300 font-medium"
                    title="Missing — needed from JD, not evidenced yet"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {keywordMatch != null && keywordMatch < 100 && missing.length > 0 && (
            <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-950 mb-0.5">Why not 100%?</p>
              <p className="text-[11px] text-amber-950/90">
                Missing {missing.length} of {keywordTotal}: {missing.slice(0, 12).join(', ')}.
                Add each into an Experience or Project bullet with evidence.
              </p>
            </div>
          )}

          {(skillGaps.length > 0 || missing.length > 0) && (
            <div className="mt-2">
              <p className="text-[11px] font-medium text-amber-900 mb-1">Skill gaps</p>
              <ul className="text-[11px] text-amber-950/90 space-y-1 list-disc pl-4">
                {(skillGaps.length
                  ? skillGaps
                  : missing.map(
                      (m) =>
                        `"${m}" is on the JD but not evidenced in an Experience/Project bullet.`
                    )
                ).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {resumeMatch == null && !matched.length && !missing.length && (
            <p className="text-xs text-ink-faint">
              Generate a resume (or click Recalculate after LaTeX exists) to see all JD keywords —
              green = matched, red = missing.
            </p>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-ink">Resume — LaTeX &amp; compiled PDF</h3>
            <button
              type="button"
              disabled={busy || !latexDraft.trim()}
              onClick={recompile}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm disabled:opacity-40"
            >
              {recompiling ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Compiling…
                </>
              ) : (
                'Recompile'
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 min-h-[28rem]">
            <div className="border border-slate-200 rounded-xl bg-violet-50/40 p-3 flex flex-col min-h-[28rem]">
              <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
                <div className="flex items-center gap-2">
                  <FileCode2 size={15} className="text-violet-600" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">LaTeX source</p>
                </div>
                {latexDirty && (
                  <span className="text-[10px] text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                    Unsaved edits — click Recompile
                  </span>
                )}
              </div>
              <textarea
                value={latexDraft}
                onChange={(e) => {
                  setLatexDraft(e.target.value);
                  setLatexDirty(true);
                }}
                placeholder="Generate a resume or paste LaTeX here…"
                className="flex-1 w-full min-h-[24rem] bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-ink focus:outline-none focus:ring-1 focus:ring-violet-200 resize-y"
                spellCheck={false}
              />
            </div>

            <div className="border border-slate-200 rounded-xl bg-sky-50/40 p-3 flex flex-col min-h-[28rem]">
              <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-sky-600" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">PDF preview</p>
                </div>
                {pdfPreviewUrl && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void downloadResume()}
                      className="inline-flex items-center gap-1 text-[11px] text-primary-500 hover:text-primary-400"
                    >
                      <Download size={12} /> Download
                    </button>
                    <a
                      href={pdfPreviewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary-500 hover:text-primary-400"
                    >
                      Open in new tab
                    </a>
                  </div>
                )}
              </div>
              {pdfPreviewUrl ? (
                <div className="flex-1 overflow-hidden bg-white min-h-[24rem] border border-slate-200 rounded-lg">
                  <iframe
                    key={pdfPreviewUrl}
                    title="Resume PDF preview"
                    src={pdfPreviewUrl}
                    className="w-full h-full min-h-[24rem] rounded-lg"
                  />
                </div>
              ) : (
                <div className="flex-1 border border-dashed border-slate-300 rounded-lg bg-white/80 flex items-center justify-center text-sm text-ink-faint text-center min-h-[24rem] px-3">
                  No PDF yet. Edit LaTeX on the left, then click Recompile.
                </div>
              )}
            </div>
          </div>
        </section>

        {(current.recruiterName || current.recruiterProfileUrl || current.contactSuggestions?.length) && (
          <div className="border border-sky-100 bg-sky-50/50 rounded-xl px-3 py-3 space-y-3">
            <h3 className="text-sm font-medium text-ink">People to contact</h3>
            {current.recruiterName && (
              <div className="text-sm text-ink">
                <span className="text-ink-faint">From listing: </span>
                {current.recruiterProfileUrl ? (
                  <a
                    href={current.recruiterProfileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-500 hover:text-primary-400"
                  >
                    {current.recruiterName}
                  </a>
                ) : (
                  current.recruiterName
                )}
              </div>
            )}
            {current.contactSuggestions?.map((c, i) => (
              <div key={i} className="text-sm border-t border-sky-100 pt-2 first:border-0 first:pt-0">
                <p className="text-ink">{c.name || c.title || 'Contact'}</p>
                {c.title && c.name && <p className="text-xs text-ink-faint">{c.title}</p>}
                {c.linkedinSearchQuery && (
                  <a
                    href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.linkedinSearchQuery)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary-500 hover:text-primary-400"
                  >
                    Search on LinkedIn
                  </a>
                )}
                {c.notes && <p className="text-xs text-ink-faint mt-1">{c.notes}</p>}
              </div>
            ))}
          </div>
        )}

        {(current.recruiterMessageDraft || current.status === 'pending_message_approval') && (
          <div>
            <label className="text-sm text-ink-muted mb-2 block">LinkedIn outreach message</label>
            <textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={4}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-3 text-sm text-ink focus:outline-none focus:border-primary-400"
            />
            <button
              type="button"
              disabled={busy}
              className="btn-secondary mt-2 inline-flex items-center gap-1.5"
              onClick={() =>
                run(
                  () =>
                    api.updateWorkspace(current._id, { recruiterMessageDraft: messageDraft }).then(
                      (j) => {
                        setCurrent(j);
                      }
                    ),
                  'Message draft saved'
                )
              }
            >
              <Save size={13} /> Save message
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-paper-line bg-white/80 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold font-display text-ink">Workspace</h3>
            <button
              type="button"
              disabled={busy}
              className="btn-secondary inline-flex items-center gap-1.5 !py-1.5"
              onClick={() =>
                run(
                  () =>
                    api
                      .generateOutreach(current._id)
                      .then((r) => {
                        setCurrent(r.job);
                        setCoverLetterDraft(r.job.coverLetterDraft || '');
                        setMessageDraft(r.job.recruiterMessageDraft || '');
                        return r;
                      }),
                  'Cover letter & outreach ready'
                )
              }
            >
              <FileText size={13} /> Generate cover letter
            </button>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-ink-muted mb-1">Interest</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const next = interest === n ? 0 : n;
                    setInterest(next);
                    void run(
                      () =>
                        api
                          .updateWorkspace(current._id, { interest: next || null })
                          .then(setCurrent),
                      next ? `Interest set to ${next}★` : 'Interest cleared'
                    );
                  }}
                  className={`h-8 w-8 rounded-full text-sm transition-all ${
                    interest >= n
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-mist text-ink-faint border border-paper-line'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ink-muted mb-1 block">
              Follow-up date
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
                className="rounded-full border border-paper-line px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                className="btn-secondary !py-1.5"
                onClick={() =>
                  run(
                    () =>
                      api
                        .updateWorkspace(current._id, {
                          followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
                        })
                        .then(setCurrent),
                    followUpAt ? 'Follow-up saved' : 'Follow-up cleared'
                  )
                }
              >
                Save
              </button>
              <button
                type="button"
                disabled={busy}
                className="chip !py-1.5"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 7);
                  const iso = d.toISOString().slice(0, 10);
                  setFollowUpAt(iso);
                  void run(
                    () =>
                      api
                        .updateWorkspace(current._id, { followUpAt: d.toISOString() })
                        .then(setCurrent),
                    'Follow-up in 7 days'
                  );
                }}
              >
                +7 days
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ink-muted mb-1 block">Notes</label>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={3}
              placeholder="Recruiter name, referral, interview notes…"
              className="w-full rounded-2xl border border-paper-line px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              className="btn-secondary mt-2 inline-flex items-center gap-1.5 !py-1.5"
              onClick={() =>
                run(
                  () => api.updateWorkspace(current._id, { notes: notesDraft }).then(setCurrent),
                  'Notes saved'
                )
              }
            >
              <Save size={13} /> Save notes
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="text-[11px] font-semibold text-ink-muted">Cover letter</label>
              <div className="flex items-center gap-2">
                {coverLetterDraft && (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-cedar inline-flex items-center gap-1"
                    onClick={async () => {
                      await navigator.clipboard.writeText(coverLetterDraft);
                      reactToast.success('Cover letter copied');
                    }}
                  >
                    <Copy size={12} /> Copy
                  </button>
                )}
                <button
                  type="button"
                  disabled={!coverLetterDraft.trim()}
                  className="text-[11px] font-semibold text-sky-800 inline-flex items-center gap-1 disabled:opacity-40"
                  onClick={() => void downloadCoverLetter()}
                >
                  <Download size={12} /> Download PDF
                </button>
              </div>
            </div>
            <textarea
              value={coverLetterDraft}
              onChange={(e) => setCoverLetterDraft(e.target.value)}
              rows={7}
              placeholder="Generate a tailored cover letter, then download PDF for Additional Attachments or copy into the form."
              className="w-full bg-white border border-paper-line rounded-2xl px-3 py-3 text-sm text-ink focus:outline-none focus:border-cedar"
            />
            <button
              type="button"
              disabled={busy || !coverLetterDraft.trim()}
              className="btn-secondary mt-2 inline-flex items-center gap-1.5 !py-1.5"
              onClick={() =>
                run(
                  () =>
                    api
                      .updateWorkspace(current._id, { coverLetterDraft })
                      .then(setCurrent),
                  'Cover letter saved'
                )
              }
            >
              <Save size={13} /> Save cover letter
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="px-3 py-3 border-t border-slate-200 text-sm text-ink bg-teal-50/80 shrink-0">
          {toast}
        </div>
      )}
    </div>
  );
}
