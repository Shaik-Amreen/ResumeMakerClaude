import { useEffect, useState } from 'react';
import {
  Briefcase,
  FileText,
  Loader2,
  Globe,
  Octagon,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import { api, type JobType, type TaskStatus } from '../api';

const TASK_LABELS: Record<TaskStatus['task'], string> = {
  idle: 'Idle',
  scraping_jobright: 'Scraping Jobright',
  scraping_linkedin: 'Scraping LinkedIn',
  scraping_indeed: 'Scraping Indeed',
  scraping_career_portals: 'Scraping Google Jobs',
  scraping_faang_portals: 'Scraping FAANG portals',
  scraping_github_lists: 'Scraping GitHub lists',
  scraping_ats: 'Scraping ATS boards (Greenhouse/Lever)',
  generating_resumes: 'Generating resumes',
  master_pipeline: 'Full pipeline',
  outreach: 'Outreach',
};

interface Props {
  jobType: JobType;
  onJobsChanged: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}

const JOB_TYPE_LABELS: Record<JobType, string> = {
  internship: 'Internships (legacy)',
  fulltime: 'Full-time / new grad',
};

export function PipelineControlPanel({ jobType, onJobsChanged, busy, setBusy }: Props) {
  const [limit, setLimit] = useState(50);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [toast, setToast] = useState('');

  const loadStatus = () => api.getTaskStatus().then(setStatus).catch(() => {});

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const run = async (label: string, fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    setToast('');
    try {
      const r = await fn();
      setToast(r.message);
      onJobsChanged();
      loadStatus();
    } catch (e) {
      setToast(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const active = status?.active ?? false;
  const stopping = status?.stopRequested ?? false;
  const progress = status?.progress;

  const statusTitle = stopping
    ? 'Stopping…'
    : status?.phase && status.phase !== 'stopping'
      ? `${TASK_LABELS[status?.task ?? 'idle']} · ${status.phase}`
      : status
        ? TASK_LABELS[status.task]
        : 'Loading…';

  return (
    <div className="glass rounded-2xl p-4 space-y-4 shrink-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Pipeline controls</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Mode: <span className="text-primary-500 font-medium">{JOB_TYPE_LABELS[jobType]}</span> · Karthik Chrome
            (port 9333) must stay open.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Max jobs total
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 50))}
            className="w-20 rounded-lg bg-white border border-slate-200 px-2 py-1.5 text-sm text-ink shadow-sm focus:outline-none focus:border-primary-400"
            title="Full pipeline: shared across all sources. Single-source buttons still use this as their own cap."
          />
        </label>
      </div>

      <div
        className={`rounded-xl border p-3 text-sm ${
          status?.lastError
            ? 'border-red-200 bg-red-50 text-red-800'
            : stopping
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : active
                ? 'border-teal-200 bg-teal-50 text-teal-900'
                : 'border-slate-200 bg-slate-50 text-ink-muted'
        }`}
      >
        <div className="flex items-center gap-2 font-medium">
          {active && !stopping ? (
            <Loader2 size={16} className="animate-spin shrink-0 text-primary-500" />
          ) : stopping ? (
            <Octagon size={16} className="shrink-0 text-amber-600" />
          ) : (
            <Play size={16} className="shrink-0 opacity-60" />
          )}
          {statusTitle}
        </div>
        <p className="mt-1 text-xs opacity-90">{status?.message || '—'}</p>
        {progress && progress.total > 0 && (
          <div className="mt-2">
            <div className="h-1.5 rounded-full bg-white/80 border border-slate-200 overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all"
                style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
              />
            </div>
            <p className="text-[10px] mt-1 text-ink-faint">
              {progress.label || `${progress.current} / ${progress.total}`}
            </p>
          </div>
        )}
        {status && (status.scrapedThisRun > 0 || status.resumesTotal > 0) && (
          <p className="text-[10px] mt-2 text-ink-faint">
            This run: {status.scrapedThisRun} scraped · {status.resumesDone}/{status.resumesTotal}{' '}
            resumes
          </p>
        )}
        {status?.lastError && (
          <p className="text-xs mt-2 text-red-700">Last error: {status.lastError}</p>
        )}
      </div>

      {status?.logs && status.logs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 max-h-48 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint mb-1">
            Activity log · live URLs
          </p>
          {status.logs.slice(-24).map((line, i) => (
            <p
              key={`${status.updatedAt}-${i}-${line.slice(0, 24)}`}
              className={`text-[11px] font-mono leading-relaxed break-all ${
                line.startsWith('🔗') ? 'text-teal-800' : 'text-ink-muted'
              }`}
            >
              {line}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('FAANG portals', () => api.scrapeFaangPortals(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-orange-50 text-orange-900 border border-orange-200 hover:bg-orange-100 disabled:opacity-40"
        >
          <Briefcase size={14} /> Scrape FAANG
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('GitHub lists', () => api.scrapeGithubLists(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 disabled:opacity-40"
        >
          <Search size={14} /> Scrape GitHub + Simplify
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('Jobright', () => api.scrapeJobright(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-violet-50 text-violet-800 border border-violet-200 hover:bg-violet-100 disabled:opacity-40"
        >
          <Search size={14} /> Scrape Jobright
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('LinkedIn', () => api.scrapeLinkedIn(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100 disabled:opacity-40"
        >
          <Globe size={14} /> Scrape LinkedIn
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('Indeed', () => api.scrapeIndeed(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-indigo-50 text-indigo-900 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-40"
        >
          <Briefcase size={14} /> Scrape Indeed
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('Google Jobs', () => api.scrapeCareerPortals(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 disabled:opacity-40"
        >
          <Briefcase size={14} /> Scrape Google
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => run('ATS boards', () => api.scrapeAts(limit, jobType))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-teal-50 text-teal-800 border border-teal-200 hover:bg-teal-100 disabled:opacity-40"
        >
          <Globe size={14} /> Scrape ATS (Greenhouse/Lever)
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() =>
            run('Resumes', () => api.generateResumes({ limit, withOutreach: true }))
          }
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-200 hover:bg-fuchsia-100 disabled:opacity-40"
          title="Only jobs still in Scraped status — does not retry failed or already-generated resumes"
        >
          <FileText size={14} /> Generate resumes (scraped only)
        </button>
        {active && (
          <button
            type="button"
            onClick={() => run('Stop', () => api.stopTask())}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-red-50 text-red-800 border border-red-200 hover:bg-red-100"
          >
            <Octagon size={14} /> {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
        <button
          type="button"
          disabled={busy || active}
          onClick={() => {
            if (
              !confirm(
                `Run full pipeline (max ${limit} new jobs total across all sources, then resumes)? Existing jobs are kept.`
              )
            )
              return;
            run('Pipeline', () =>
              api.runPipeline({ deleteFirst: false, perSourceCap: limit, jobType })
            );
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-40"
        >
          <Play size={14} /> Full pipeline
        </button>
        <button
          type="button"
          disabled={busy || active}
          onClick={() => {
            if (!confirm('Delete ALL jobs and their resume files? This cannot be undone.')) return;
            run('Delete all', () => api.deleteAll());
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-red-50 text-red-800 border border-red-200 hover:bg-red-100 disabled:opacity-40"
        >
          <Trash2 size={14} /> Delete all jobs
        </button>
      </div>

      {toast && <p className="text-xs text-ink-muted">{toast}</p>}
    </div>
  );
}
