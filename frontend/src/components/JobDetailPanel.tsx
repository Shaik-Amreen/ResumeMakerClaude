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
} from 'lucide-react';
import type { Job, JobStatus } from '../types';
import { api, UPLOADS_BASE } from '../api';
import { jobApplicants, formatPostedOnPlatform, formatScrapedOn, platformLabel } from '../utils/jobFilters';

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
  failed: 'Failed',
};

const MANUAL_STATUSES: { value: JobStatus; label: string }[] = [
  { value: 'scraped', label: 'Scraped' },
  { value: 'resume_generated', label: 'Resume Generated' },
  { value: 'pdf_uploaded', label: 'PDF Uploaded' },
  { value: 'applied', label: 'Applied' },
  { value: 'failed', label: 'Failed / Skipped' },
];

interface Props {
  job: Job;
  onUpdated: () => void;
}

export function JobDetailPanel({ job, onUpdated }: Props) {
  const [current, setCurrent] = useState(job);
  const [messageDraft, setMessageDraft] = useState(job.recruiterMessageDraft || '');
  const [latexDraft, setLatexDraft] = useState(job.latexResume || '');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    setCurrent(job);
    setMessageDraft(job.recruiterMessageDraft || '');
    setLatexDraft(job.latexResume || '');
  }, [job]);

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
      await navigator.clipboard.writeText(current.jobDescription);
      setToast('Job description copied to clipboard');
    } catch {
      setToast('Could not copy — select text manually');
    }
  };

  const applicants = jobApplicants(current);
  const postedLabel = formatPostedOnPlatform(current);
  const scrapedLabel = formatScrapedOn(current);
  const platform = platformLabel(current.platform || current.source);
  const pdfPreviewUrl = current.pdfUrl ? `${UPLOADS_BASE}${current.pdfUrl}` : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-6 border-b border-white/10 bg-white/5 shrink-0">
        <p className="text-xs uppercase tracking-widest text-primary-400 mb-1">
          {current.jobType} · {STATUS_LABELS[current.status] || current.status}
        </p>
        <h2 className="text-2xl font-bold">{current.title}</h2>
        <p className="text-gray-400 mt-1">
          {current.company}
          {current.location ? ` · ${current.location}` : ''}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-sm text-gray-400">
          {postedLabel && (
            <span className="inline-flex items-center gap-1.5">
              <Clock size={15} className="text-primary-400" />
              <span className="text-gray-200">{postedLabel}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Globe size={15} className="text-primary-400" />
            <span className="text-gray-200">{scrapedLabel}</span>
          </span>
          {applicants && (
            <span className="inline-flex items-center gap-1.5">
              <Users size={15} className="text-primary-400" />
              {applicants}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {current.approvalNote && (
          <div className="rounded-2xl border border-primary-500/30 bg-primary-500/10 p-4 text-sm text-primary-100">
            {current.approvalNote}
          </div>
        )}
        {current.errorMessage && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200 flex gap-2">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            {current.errorMessage}
          </div>
        )}

        <div>
          <label className="text-sm text-gray-400 mb-2 block">Status</label>
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
            className="w-full max-w-xs rounded-xl bg-black/40 border border-white/10 px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500/50"
          >
            {MANUAL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-sm"
          >
            <ExternalLink size={16} /> View on {platform}
          </a>

          <button
            type="button"
            onClick={copyJd}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500/15 border border-primary-500/35 hover:bg-primary-500/25 text-sm"
          >
            <Copy size={16} /> Copy JD
          </button>

          <button
            type="button"
            disabled={busy || current.status === 'resume_generating'}
            onClick={() =>
              run(() => api.generateResumeOllama(current._id), 'Ollama resume generation started')
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/25 border border-violet-500/50 hover:bg-violet-500/35 text-sm disabled:opacity-40"
          >
            Generate with Ollama
          </button>

          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500/20 border border-blue-500/40 hover:bg-blue-500/30 text-sm cursor-pointer">
            <Upload size={16} /> Upload PDF
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

          {current.status === 'pending_resume_approval' && current.pdfPath && (
            <>
              <button
                disabled={busy}
                onClick={() => run(() => api.approveResume(current._id), 'Resume approved')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-sm"
              >
                <CheckCircle2 size={16} /> Approve Resume
              </button>
              {current.jobType === 'fulltime' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.approveResumeAndApply(current._id).then((r) => r.message),
                      'Approved — auto-apply started'
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/25 border border-indigo-500/50 hover:bg-indigo-500/35 text-sm"
                >
                  <Send size={16} /> Approve & Auto-Apply
                </button>
              )}
            </>
          )}

          {current.status === 'pdf_uploaded' && current.pdfPath && current.jobType === 'fulltime' && (
            <button
              disabled={busy}
              onClick={() => run(() => api.apply(current._id), 'Auto-apply started')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 hover:bg-indigo-500/30 text-sm"
            >
              <Send size={16} /> Auto-Apply
            </button>
          )}

          {current.status === 'pdf_uploaded' && current.pdfPath && current.jobType === 'internship' && (
            <p className="text-sm text-slate-400">
              Auto-apply is for full-time roles only — submit this internship manually on the company site, then mark as applied.
            </p>
          )}

          {current.status === 'pending_message_approval' && (
            <button
              disabled={busy}
              onClick={() =>
                run(() => api.approveMessage(current._id, messageDraft), 'Message approved')
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 hover:bg-amber-500/30 text-sm"
            >
              <MessageSquare size={16} /> Approve Message
            </button>
          )}

          {current.status === 'pending_submit_approval' && (
            <button
              disabled={busy}
              onClick={() => run(() => api.approveSubmit(current._id), 'Submit approved')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-sm"
            >
              <CheckCircle2 size={16} /> Approve Submit
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-gray-200">Manual Ollama paste (optional)</h3>
            <p className="text-xs text-gray-400 mt-1">
              Or copy LaTeX from Ollama desktop yourself and paste below.
            </p>
          </div>
          <label className="text-sm text-gray-400 block">LaTeX from Ollama</label>
          <textarea
            value={latexDraft}
            onChange={(e) => setLatexDraft(e.target.value)}
            rows={6}
            placeholder="Paste LaTeX code block from Ollama desktop…"
            className="w-full rounded-xl bg-black/40 border border-white/10 p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-primary-500/50"
          />
          <button
            type="button"
            disabled={busy || !latexDraft.trim()}
            onClick={() =>
              run(async () => {
                try {
                  return await api.submitLatex(current._id, latexDraft);
                } catch (e) {
                  await onUpdated();
                  const refreshed = await api.getJob(current._id);
                  setCurrent(refreshed);
                  throw e;
                }
              }, 'LaTeX processed — check PDF preview')
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-500/40 hover:bg-violet-500/30 text-sm disabled:opacity-40"
          >
            Build PDF from pasted LaTeX
          </button>
        </div>

        {pdfPreviewUrl && (
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-2">Resume PDF preview</h3>
            <div className="rounded-2xl border border-white/10 overflow-hidden bg-white">
              <iframe
                title="Resume PDF preview"
                src={pdfPreviewUrl}
                className="w-full h-[min(70vh,36rem)]"
              />
            </div>
            <a
              href={pdfPreviewUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary-400 hover:text-primary-300 mt-2 inline-block"
            >
              Open PDF in new tab
            </a>
          </div>
        )}

        {current.status === 'pending_message_approval' && (
          <div>
            <label className="text-sm text-gray-400 mb-2 block">LinkedIn message draft</label>
            <textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={4}
              className="w-full rounded-2xl bg-black/40 border border-white/10 p-4 text-sm focus:outline-none focus:border-primary-500/50"
            />
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-300">Job Description</h3>
            <button
              type="button"
              onClick={copyJd}
              className="text-xs text-primary-400 hover:text-primary-300 inline-flex items-center gap-1"
            >
              <Copy size={13} /> Copy
            </button>
          </div>
          <div className="rounded-2xl bg-black/30 border border-white/5 p-4 text-sm text-gray-300 max-h-[min(50vh,28rem)] overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {current.jobDescription}
          </div>
        </div>
      </div>

      {toast && (
        <div className="px-6 py-3 border-t border-white/10 text-sm text-gray-300 bg-white/5 shrink-0">
          {toast}
        </div>
      )}
    </div>
  );
}
