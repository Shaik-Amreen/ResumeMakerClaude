import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  Eraser,
  FileText,
  Loader2,
  Globe,
  Octagon,
  Play,
  Search,
  Trash2,
} from 'lucide-react';
import { api, type TaskStatus } from '../api';
import { useConfirm } from './ConfirmProvider';
import { PLATFORM_LABELS, type JobSource } from '../utils/jobFilters';

const TASK_LABELS: Record<TaskStatus['task'], string> = {
  idle: 'Idle',
  scraping_jobright: 'Scraping Jobright',
  scraping_linkedin: 'Scraping LinkedIn',
  scraping_indeed: 'Scraping Indeed',
  scraping_career_portals: 'Scraping Google Jobs',
  scraping_faang_portals: 'Scraping FAANG portals',
  scraping_github_lists: 'Scraping GitHub lists',
  scraping_ats: 'Scraping ATS boards (Greenhouse/Lever)',
  scraping_scoutify: 'Scraping Scoutify',
  generating_resumes: 'Generating resumes',
  master_pipeline: 'Full pipeline',
  applying_career: 'Career-page apply',
  outreach: 'Outreach',
};

const RESUME_SOURCE_OPTIONS: Array<{ value: '' | JobSource; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'scoutify', label: PLATFORM_LABELS.scoutify },
  { value: 'jobright', label: PLATFORM_LABELS.jobright },
  { value: 'linkedin', label: PLATFORM_LABELS.linkedin },
  { value: 'indeed', label: PLATFORM_LABELS.indeed },
  { value: 'simplify', label: PLATFORM_LABELS.simplify },
  { value: 'greenhouse', label: PLATFORM_LABELS.greenhouse },
  { value: 'lever', label: PLATFORM_LABELS.lever },
  { value: 'github', label: PLATFORM_LABELS.github },
  { value: 'career_portal', label: PLATFORM_LABELS.career_portal },
  { value: 'company_portal', label: PLATFORM_LABELS.company_portal },
  { value: 'other', label: PLATFORM_LABELS.other },
];

interface Props {
  onJobsChanged: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}

/** Compact pipeline controls — collapsed when idle so the job list stays above the fold. */
export function PipelineControlPanel({ onJobsChanged, busy, setBusy }: Props) {
  const confirm = useConfirm();
  const [limit, setLimit] = useState(50);
  const [resumeSource, setResumeSource] = useState<'' | JobSource>('');
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const loadStatus = () => api.getTaskStatus().then(setStatus).catch(() => {});

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const active = status?.active ?? false;
  const stopping = status?.stopRequested ?? false;
  const progress = status?.progress;
  const locked = busy || active;
  const sourceLabel =
    RESUME_SOURCE_OPTIONS.find((o) => o.value === resumeSource)?.label || 'All sources';

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const run = async (label: string, fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(r.message);
      onJobsChanged();
      loadStatus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const statusTitle = stopping
    ? 'Stopping…'
    : status?.phase && status.phase !== 'stopping'
      ? `${TASK_LABELS[status?.task ?? 'idle']} · ${status.phase}`
      : status
        ? TASK_LABELS[status.task]
        : 'Loading…';

  const statusMsg = (status?.message || 'Ready — scrape, generate, or apply.')
    .replace(/\s*—\s*/g, ' · ')
    .replace(/—/g, ' - ')
    .replace(/\.\./g, '…');

  const tone = status?.lastError
    ? 'border-red-200 bg-red-50 text-red-900'
    : stopping
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : active
        ? 'border-cedar/25 bg-cedar-soft text-cedar-ink'
        : 'border-paper-line bg-white/80 text-ink-muted';

  return (
    <section className="surface overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-b transition-colors ${tone} ${open ? '' : 'border-transparent'}`}
      >
        <span className="shrink-0">
          {active && !stopping ? (
            <Loader2 size={15} className="animate-spin text-cedar" />
          ) : stopping ? (
            <Octagon size={15} className="text-amber-600" />
          ) : (
            <Play size={15} className="opacity-50" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold font-display truncate">{statusTitle}</span>
          <span className="block text-[11px] opacity-80 truncate">{statusMsg}</span>
        </span>
        {progress && progress.total > 0 && (
          <span className="text-[10px] font-semibold tabular-nums shrink-0 opacity-70">
            {progress.current}/{progress.total}
          </span>
        )}
        {open ? (
          <ChevronUp size={16} className="shrink-0 opacity-50" />
        ) : (
          <ChevronDown size={16} className="shrink-0 opacity-50" />
        )}
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-paper-line/80 bg-white/50">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Cap
              <input
                type="number"
                min={1}
                max={500}
                value={limit}
                disabled={locked}
                onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                className="ml-1.5 w-14 rounded-lg border border-paper-line bg-white px-2 py-1 text-xs tabular-nums"
              />
            </label>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-1.5">
              Resume category
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RESUME_SOURCE_OPTIONS.map((o) => {
                const activeSource = resumeSource === o.value;
                return (
                  <button
                    key={o.value || 'all'}
                    type="button"
                    disabled={locked}
                    onClick={() => setResumeSource(o.value)}
                    className={`chip !px-2.5 !py-1.5 ${
                      activeSource ? '!bg-cedar-soft !border-cedar/30 !text-cedar-ink font-semibold' : ''
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['Scoutify', () => api.scrapeScoutify(limit), Search],
                ['Jobright', () => api.scrapeJobright(limit, 'fulltime'), Search],
                ['LinkedIn', () => api.scrapeLinkedIn(limit, 'fulltime'), Search],
                ['Indeed', () => api.scrapeIndeed(limit, 'fulltime'), Search],
                ['Google Jobs', () => api.scrapeCareerPortals(limit, 'fulltime'), Globe],
                ['ATS boards', () => api.scrapeAts(limit, 'fulltime'), Globe],
              ] as const
            ).map(([label, fn, Icon]) => (
              <button
                key={label}
                type="button"
                disabled={locked}
                onClick={() => run(label, fn)}
                className="chip !px-2.5 !py-1.5"
              >
                <Icon size={13} className="text-cedar opacity-80" /> {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-paper-line/60">
            <button
              type="button"
              disabled={locked}
              onClick={() =>
                run('Resumes', () =>
                  api.generateResumes({
                    limit,
                    withOutreach: false,
                    ...(resumeSource ? { source: resumeSource } : {}),
                  })
                )
              }
              className="chip-emphasis !py-1.5"
            >
              <FileText size={13} /> Generate {resumeSource ? sourceLabel : 'all'} resumes
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={async () => {
                const ok = await confirm({
                  title: resumeSource ? `Clear ${sourceLabel} resumes?` : 'Clear ALL resumes?',
                  message: resumeSource
                    ? `Remove generated LaTeX/PDFs for ${sourceLabel} jobs and reset them to scraped. Jobs stay in the tracker (applied/interview kept).`
                    : 'Remove generated LaTeX/PDFs for all non-applied jobs and reset them to scraped. Jobs stay in the tracker.',
                  confirmText: resumeSource ? `Clear ${sourceLabel}` : 'Clear all resumes',
                  variant: 'danger',
                });
                if (!ok) return;
                run('Clear resumes', () =>
                  api.clearResumes(resumeSource ? { source: resumeSource } : {})
                );
              }}
              className="chip-danger !py-1.5"
            >
              <Eraser size={13} /> Clear {resumeSource ? sourceLabel : 'all'} resumes
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Run Full Pipeline?',
                  message: `Run full pipeline (max ${limit} new jobs across all sources, then resumes)? Existing jobs are kept.`,
                  confirmText: 'Start Pipeline',
                  variant: 'primary',
                });
                if (!ok) return;
                run('Pipeline', () =>
                  api.runPipeline({ deleteFirst: false, perSourceCap: limit, jobType: 'fulltime' })
                );
              }}
              className="chip-emphasis !py-1.5"
            >
              <Play size={13} /> Full pipeline
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => run('Career apply', () => api.applyCareerQueue(Math.min(limit, 20)))}
              className="btn-primary inline-flex items-center gap-1.5 !py-1.5 !px-3"
            >
              <Briefcase size={13} /> Apply ready
            </button>
            {active && (
              <button
                type="button"
                onClick={() => run('Stop', () => api.stopTask())}
                className="chip-danger !py-1.5"
              >
                <Octagon size={13} /> {stopping ? 'Stopping…' : 'Stop'}
              </button>
            )}
            <button
              type="button"
              disabled={locked}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete ALL Jobs?',
                  message: 'Delete ALL jobs and their resume files? This cannot be undone.',
                  confirmText: 'Delete All Jobs',
                  variant: 'danger',
                });
                if (!ok) return;
                run('Delete all', () => api.deleteAll());
              }}
              className="chip-danger !py-1.5"
            >
              <Trash2 size={13} /> Delete all
            </button>
          </div>

          {status?.logs && status.logs.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowLogs((v) => !v)}
                className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint hover:text-ink-muted"
              >
                Activity {showLogs ? '▾' : '▸'} ({status.logs.length})
              </button>
              {showLogs && (
                <div className="mt-1.5 rounded-xl border border-paper-line bg-white/70 p-2 max-h-28 overflow-y-auto">
                  {status.logs.slice(-16).map((line, i) => (
                    <p
                      key={`${status.updatedAt}-${i}-${line.slice(0, 20)}`}
                      className="text-[10px] font-mono leading-snug break-all text-ink-muted"
                    >
                      {line.replace(/\.\./g, '…').replace(/\s*—\s*/g, ' · ')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
