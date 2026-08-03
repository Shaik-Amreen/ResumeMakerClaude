import { useEffect, useState } from 'react';
import {
  ExternalLink,
  Upload,
  CheckCircle2,
  MessageSquare,
  Send,
  AlertTriangle,
  Copy,
  Users,
  Clock,
  Globe,
  Trash2,
  FileCode2,
  FileText,
  Pencil,
  Save,
  Download,
} from 'lucide-react';
import type { Job, JobStatus, ResumePhase } from '../types';
import { api, UPLOADS_BASE } from '../api';
import { jobApplicants, formatPostedOnPlatform, formatScrapedOn, platformLabel } from '../utils/jobFilters';

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
const STATUS_LABELS: Record<string, string> = {
  scraped: 'Scraped',
  resume_generating: 'Generating Resume',
  resume_generated: 'Resume Generated',
  pending_resume_approval: 'Review PDF',
  pdf_uploaded: 'PDF Uploaded',
  applying: 'Applying',
  pending_message_approval: 'Approve Message',
  pending_submit_approval: 'Approve Submit',
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  confused_hold: 'Confused - Hold',
  invalid_job: 'Invalid job',
  accepted: 'Accepted',
  failed: 'Failed',
};

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

const MANUAL_STATUSES: { value: JobStatus; label: string }[] = [
  { value: 'scraped', label: 'Scraped' },
  { value: 'resume_generated', label: 'Resume Generated' },
  { value: 'pdf_uploaded', label: 'PDF Uploaded' },
  { value: 'applied', label: 'Applied' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'interview', label: 'Interview' },
  { value: 'confused_hold', label: 'Confused - Hold' },
  { value: 'invalid_job', label: 'Invalid job' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'failed', label: 'Failed / Skipped' },
];

interface Props {
  job: Job;
  onUpdated: () => void;
  onDeleted?: () => void;
}

export function JobDetailPanel({ job, onUpdated, onDeleted }: Props) {
  const [current, setCurrent] = useState(job);
  const [messageDraft, setMessageDraft] = useState(job.recruiterMessageDraft || '');
  const [coverLetterDraft, setCoverLetterDraft] = useState(job.coverLetterDraft || '');
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
    setCurrent(job);
    setMessageDraft(job.recruiterMessageDraft || '');
    setCoverLetterDraft(job.coverLetterDraft || '');
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

  const run = async (fn: () => Promise<unknown>, successMsg: string) => {
    setBusy(true);
    setToast('');
    try {
      await fn();
      setToast(successMsg);
      onUpdated();
      const refreshed = await api.getJob(current._id);
      setCurrent(refreshed);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const copyJd = async () => {
    try {
      await navigator.clipboard.writeText(editingJd ? jdDraft : current.jobDescription);
      setToast('Job description copied to clipboard');
    } catch {
      setToast('Could not copy — select text manually');
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
            ? `Recompiled — PDF updated (${pageCount} page${pageCount === 1 ? '' : 's'})`
            : 'Recompiled — PDF updated from your LaTeX'
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
  const platform = platformLabel(current.platform || current.source);
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
          `Scores updated — resume ${updated.matchScore ?? '—'}% · keywords ${updated.keywordMatchScore ?? '—'}%`
        );
      } else {
        const result = await api.refreshMatchScore(current._id);
        setCurrent(result.job);
        onUpdated();
        setToast(
          `Scores updated — resume ${result.resumeMatchScore}% · keywords ${result.keywordMatchScore}%`
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
      <div className="px-3 py-4 border-b border-slate-200 bg-gradient-to-r from-teal-50/90 via-white to-sky-50/70 shrink-0">
        <p className="text-xs uppercase tracking-widest text-primary-500 mb-1 font-medium">
          {current.jobType} · {STATUS_LABELS[current.status] || current.status}
          {resumeMatch != null ? ` · Resume ${resumeMatch}%` : ''}
          {keywordMatch != null ? ` · Keywords ${keywordMatch}%` : ''}
        </p>
        <h2 className="text-2xl font-bold text-ink">{current.title}</h2>
        <p className="text-ink-muted mt-1">
          {current.company}
          {current.location ? ` · ${current.location}` : ''}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-sm text-ink-muted">
          {postedLabel && (
            <span className="inline-flex items-center gap-1.5">
              <Clock size={15} className="text-primary-500" />
              <span className="text-ink">{postedLabel}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Globe size={15} className="text-sky-500" />
            <span className="text-ink">
              <span className="text-ink-faint">Scraped date · </span>
              {scrapedLabel.replace(/^Scraped on\s+/i, '')}
            </span>
          </span>
          {applicants && (
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} className="text-amber-500" />
              {applicants}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <select
            value={
              MANUAL_STATUSES.some((s) => s.value === current.status)
                ? current.status
                : 'scraped'
            }
            disabled={busy}
            onChange={(e) =>
              run(
                () => api.updateStatus(current._id, e.target.value as JobStatus),
                'Status updated'
              )
            }
            className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:border-primary-400"
          >
            {MANUAL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:bg-slate-100 text-sm text-ink"
          >
            <ExternalLink size={15} /> View on {platform}
          </a>

          <button
            type="button"
            onClick={copyJd}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-50 border border-teal-200 hover:bg-teal-100 text-sm text-teal-800"
          >
            <Copy size={15} /> Copy JD
          </button>

          <button
            type="button"
            disabled={busy || current.status === 'resume_generating'}
            onClick={() =>
              run(
                () => api.generateResumeOllama(current._id),
                `Resume generation started — check LaTeX/PDF in ~1–3 min`
              )
            }
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200 hover:bg-violet-100 text-sm text-violet-800 disabled:opacity-40"
          >
            Generate Resume
          </button>

          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sm text-sky-800 cursor-pointer">
            <Upload size={15} /> Upload PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) run(() => api.uploadPdf(current._id, file), 'PDF uploaded — review and approve');
              }}
            />
          </label>

          {current.pdfUrl && (
            <button
              type="button"
              onClick={() => void downloadResume()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-sm text-emerald-800"
            >
              <Download size={15} /> Download Resume
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !confirm(
                  `Delete this job?\n\n${current.title} @ ${current.company}\n\nThis removes the listing and any resume PDF/TeX files.`
                )
              ) {
                return;
              }
              setBusy(true);
              setToast('');
              api
                .deleteJob(current._id)
                .then((r) => {
                  setToast(r.message);
                  onDeleted?.();
                  onUpdated();
                })
                .catch((e) => {
                  setToast(e instanceof Error ? e.message : 'Delete failed');
                })
                .finally(() => setBusy(false));
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 hover:bg-red-100 text-sm text-red-800 disabled:opacity-40"
          >
            <Trash2 size={15} /> Delete
          </button>

          {current.status === 'pending_resume_approval' && current.pdfPath && (
            <>
              <button
                disabled={busy}
                onClick={() => run(() => api.approveResume(current._id), 'Resume approved')}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-sm text-emerald-800"
              >
                <CheckCircle2 size={15} /> Approve Resume
              </button>
              {current.priority !== 'faang' &&
                /linkedin\.com\/(jobs|job)/i.test(current.url) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.approveResumeAndApply(current._id).then((r) => r.message),
                      'Approved — LinkedIn Easy Apply started (approve before Submit)'
                    )
                  }
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-sm text-indigo-800"
                >
                  <Send size={15} /> Approve & Easy Apply
                </button>
              )}
            </>
          )}

          {current.status === 'pdf_uploaded' &&
            current.pdfPath &&
            current.priority !== 'faang' &&
            /linkedin\.com\/(jobs|job)/i.test(current.url) && (
            <button
              disabled={busy}
              onClick={() => run(() => api.apply(current._id), 'LinkedIn Easy Apply started')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-sm text-indigo-800"
            >
              <Send size={15} /> Easy Apply
            </button>
          )}

          {current.status === 'pending_message_approval' && (
            <button
              disabled={busy}
              onClick={() =>
                run(() => api.approveMessage(current._id, messageDraft), 'Message approved')
              }
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 text-sm text-amber-900"
            >
              <MessageSquare size={15} /> Approve Message
            </button>
          )}

          {current.status === 'pending_submit_approval' && (
            <button
              disabled={busy}
              onClick={() => run(() => api.approveSubmit(current._id), 'Submit approved')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-sm text-emerald-800"
            >
              <CheckCircle2 size={15} /> Approve Submit
            </button>
          )}
        </div>

        {current.priority === 'faang' && (
          <p className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            FAANG/MANGO — apply yourself on the company site. Auto-apply is disabled for these roles.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 bg-white">
        {current.approvalNote && (
          <div className="border border-teal-200 bg-teal-50 rounded-xl px-3 py-3 text-sm text-teal-900">
            {current.approvalNote}
          </div>
        )}

        {(isGenerating || current.resumePhase === 'done' || current.resumePhase === 'failed') && (
          <section className="border border-violet-200 rounded-xl bg-violet-50/60 px-3 py-3">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-violet-900">
                {isGenerating ? 'Resume progress' : 'Last generation'}
              </h3>
              {isGenerating && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-violet-700">
                  <span className="inline-block h-3 w-3 border-2 border-violet-300 border-t-violet-700 rounded-full animate-spin" />
                  Live
                </span>
              )}
            </div>
            <ol className="space-y-2">
              {RESUME_STEPS.map((step, i) => {
                const failed = current.resumePhase === 'failed';
                const done = current.resumePhase === 'done' || (activeStep >= 0 && i < activeStep);
                const active = !failed && activeStep === i;
                return (
                  <li key={step.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-bold ${
                        failed && activeStep === -2 && i === RESUME_STEPS.length - 1
                          ? 'bg-red-100 border-red-300 text-red-700'
                          : done
                            ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                            : active
                              ? 'bg-violet-200 border-violet-400 text-violet-900'
                              : 'bg-white border-slate-200 text-slate-400'
                      }`}
                    >
                      {done ? '✓' : active ? '…' : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`font-medium ${
                          active ? 'text-violet-900' : done ? 'text-emerald-900' : 'text-ink-muted'
                        }`}
                      >
                        {step.label}
                        {active && step.id === 'checking_match' && keywordMatch != null
                          ? ` (${keywordMatch}%)`
                          : ''}
                        {active && step.id === 'checking_match' && resumeMatch != null
                          ? ` · resume ${resumeMatch}%`
                          : ''}
                      </p>
                      {active && current.approvalNote && (
                        <p className="text-[11px] text-violet-800/80 mt-0.5 leading-snug">
                          {current.approvalNote}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {current.resumePhase === 'failed' && (
              <p className="mt-2 text-xs text-red-700">
                Generation stopped — check the error note and edit JD / regenerate.
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
          </div>
        )}

        {current.coverLetterDraft && (
          <div>
            <label className="text-sm text-ink-muted mb-2 block">Cover letter draft</label>
            <textarea
              value={coverLetterDraft}
              onChange={(e) => setCoverLetterDraft(e.target.value)}
              rows={8}
              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-3 text-sm text-ink focus:outline-none focus:border-primary-400"
            />
          </div>
        )}
      </div>

      {toast && (
        <div className="px-3 py-3 border-t border-slate-200 text-sm text-ink bg-teal-50/80 shrink-0">
          {toast}
        </div>
      )}
    </div>
  );
}
