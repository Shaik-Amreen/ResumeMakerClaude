import { WorkQueueBar } from './components/WorkQueueBar';
import { PipelineControlPanel } from './components/PipelineControlPanel';
import { AnswerBankModal } from './components/AnswerBankModal';
import { Background3D } from './components/Background3D';
import { EmptyState } from './components/EmptyState';
import { useConfirm } from './components/ConfirmProvider';
import { api, type SchedulerStatus } from './api';
import type { Job, JobStatus } from './types';
import {
  DEFAULT_FILTERS,
  filterAndSortJobs,
  formatPostedOnPlatform,
  formatScrapedOn,
  isActionQueueJob,
  isReadyToApply,
  jobApplicants,
  type JobFilters,
} from './utils/jobFilters';
import {
  computeInsights,
  downloadTextFile,
  exportJobsCsv,
} from './utils/searchInsights';
import { STATUS_STYLES, statusLabel, needsUserAttention } from './utils/statusUi';
import { detectAtsUi, ATS_BADGE_CLASS } from './utils/atsUi';
import { PipelineBoard } from './components/PipelineBoard';
import { JobDetailPanel } from './components/JobDetailPanel';
import { JobFiltersBar } from './components/JobFiltersBar';
import {
  Briefcase,
  FileText,
  CheckCircle,
  Bell,
  Loader2,
  Users,
  Clock,
  Globe,
  Send,
  Hand,
} from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import { useCallback, useEffect, useMemo, useState } from 'react';

const WINDOW_LABELS: Record<string, string> = {
  job_cycle: '24/7 · Full-time / new-grad pipeline',
  internship_cycle: 'Legacy — internships disabled',
  night_faang_mango: 'Legacy window label',
  morning_faang_mango: 'Legacy window label',
  fulltime_jobs: 'Legacy window label',
  idle: 'Idle / cooldown',
};

const QUEUE_FILTERS: JobFilters = {
  ...DEFAULT_FILTERS,
  status: 'action_queue',
  sort: 'action',
};

function App() {
  const confirm = useConfirm();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS);
  const [panelBusy, setPanelBusy] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [answersOpen, setAnswersOpen] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setJobs(data);
      setSelectedId((prev) => {
        if (prev && data.some((j) => j._id === prev)) return prev;
        const queue = filterAndSortJobs(data, QUEUE_FILTERS);
        return queue[0]?._id ?? data[0]?._id ?? null;
      });
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const visibleJobs = useMemo(() => filterAndSortJobs(jobs, filters), [jobs, filters]);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 8000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  useEffect(() => {
    const loadScheduler = () => api.getSchedulerStatus().then(setScheduler).catch(() => {});
    loadScheduler();
    const interval = setInterval(loadScheduler, 60000);
    return () => clearInterval(interval);
  }, []);

  // Keep selection inside the visible list when filters change.
  useEffect(() => {
    if (!visibleJobs.length) return;
    if (selectedId && visibleJobs.some((j) => j._id === selectedId)) return;
    setSelectedId(visibleJobs[0]._id);
  }, [visibleJobs, selectedId]);

  const selected =
    visibleJobs.find((j) => j._id === selectedId) ??
    jobs.find((j) => j._id === selectedId) ??
    null;

  const pendingCount = jobs.filter((j) => needsUserAttention(j.status, j.pendingAction)).length;
  const totalJobs = jobs.length;
  const resumesReady = jobs.filter((j) =>
    ['resume_generated', 'pending_resume_approval', 'pdf_uploaded', 'applied'].includes(j.status)
  ).length;
  const applied = jobs.filter((j) => j.status === 'applied').length;
  const readyApply = jobs.filter((j) => isReadyToApply(j)).length;
  const queueCount = jobs.filter((j) => isActionQueueJob(j)).length;
  const scrapedCount = jobs.filter((j) => j.status === 'scraped').length;
  const insights = useMemo(() => computeInsights(jobs), [jobs]);

  const selectedIndex = selectedId
    ? visibleJobs.findIndex((j) => j._id === selectedId)
    : -1;

  const selectRelative = useCallback(
    (delta: number) => {
      if (!visibleJobs.length) return;
      const idx = selectedIndex >= 0 ? selectedIndex : 0;
      const next = visibleJobs[Math.min(visibleJobs.length - 1, Math.max(0, idx + delta))];
      if (next) setSelectedId(next._id);
    },
    [visibleJobs, selectedIndex]
  );

  const advanceAfterGate = useCallback(async (doneId: string) => {
    try {
      const data = await api.getJobs();
      setJobs(data);
      setFilters(QUEUE_FILTERS);
      const queue = filterAndSortJobs(data, QUEUE_FILTERS);
      const idx = queue.findIndex((j) => j._id === doneId);
      const next =
        (idx >= 0 ? queue.slice(idx + 1) : queue).find((j) => j._id !== doneId) ||
        queue.find((j) => j._id !== doneId);
      if (next) {
        setSelectedId(next._id);
        toast.info(`Next: ${next.company} · ${next.title.slice(0, 48)}`);
      } else {
        setSelectedId(doneId);
        toast.success('Queue clear — nothing waiting on you');
      }
    } catch {
      // keep current selection
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'j' || e.key === 'J' || e.key === ']') {
        e.preventDefault();
        selectRelative(1);
      } else if (e.key === 'k' || e.key === 'K' || e.key === '[') {
        e.preventDefault();
        selectRelative(-1);
      } else if (e.key === '1') {
        setFilters(QUEUE_FILTERS);
      } else if (e.key === '2') {
        setFilters((f) => ({ ...f, status: 'needs_you', sort: 'action' }));
      } else if (e.key === '3') {
        setFilters((f) => ({ ...f, status: 'ready_apply', sort: 'newest' }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectRelative]);

  const runFullPipeline = async () => {
    const ok = await confirm({
      title: 'Run Full Pipeline?',
      message:
        'Run full pipeline (FAANG → GitHub → Scoutify → Jobright → LinkedIn → Indeed → Google → ATS, up to 50 new jobs, then resumes)? Existing jobs are kept.',
      confirmText: 'Run Pipeline',
      variant: 'primary',
    });
    if (!ok) return;

    setPanelBusy(true);
    try {
      const r = await api.runPipeline({ deleteFirst: false, perSourceCap: 50, jobType: 'fulltime' });
      toast.success(r.message);
      loadJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Pipeline failed to start');
    } finally {
      setPanelBusy(false);
    }
  };

  const refreshListings = async () => {
    setPanelBusy(true);
    try {
      await api.refreshJobs();
      toast.info('Refreshing posted dates & applicant counts for all jobs.');
      loadJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setPanelBusy(false);
    }
  };

  const controlsBusy = scraping || panelBusy;

  const moveBoardJob = async (id: string, status: JobStatus) => {
    try {
      await api.updateStatus(id, status);
      toast.success(`Moved to ${statusLabel(status)}`);
      await loadJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Move failed');
    }
  };

  return (
    <div className="min-h-screen bg-paper text-ink relative font-sans flex flex-col">
      <ToastContainer
        position="top-right"
        autoClose={3200}
        theme="light"
        className="text-sm font-sans"
        toastClassName="!rounded-2xl !shadow-float !border !border-white/80 !bg-white/95 !backdrop-blur-xl"
      />
      <Background3D />
      <AnswerBankModal open={answersOpen} onClose={() => setAnswersOpen(false)} />

      <div className="relative z-10 flex flex-col flex-1 max-w-[1600px] w-full mx-auto p-3 md:p-4 gap-3 min-h-0">
        <header className="shrink-0 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div className="min-w-0">
            <p className="section-label text-cedar">Karthik · Full-time / new-grad</p>
            <h1 className="display-title text-xl md:text-2xl text-ink">
              Career apply workspace
            </h1>
            {scheduler && (
              <p className="text-[11px] text-ink-faint mt-0.5">
                Scheduler {scheduler.enabled ? 'on' : 'off'} · {scheduler.localTime} PT ·{' '}
                {WINDOW_LABELS[scheduler.currentWindow]}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: 'Reset All Jobs?',
                  message: 'Reset ALL jobs to Scraped? Clears PDFs and LaTeX.',
                  confirmText: 'Reset All',
                  variant: 'warning',
                });
                if (!ok) return;
                setScraping(true);
                try {
                  const r = await api.resetAll();
                  toast.success(r.message);
                  loadJobs();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Reset failed');
                } finally {
                  setScraping(false);
                }
              }}
              disabled={controlsBusy}
              className="btn-secondary !py-1.5 !px-3 disabled:opacity-50"
            >
              Reset
            </button>
            <button
              onClick={refreshListings}
              disabled={controlsBusy}
              className="btn-secondary !py-1.5 !px-3 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              onClick={runFullPipeline}
              disabled={controlsBusy}
              className="btn-primary inline-flex items-center gap-1.5 !py-1.5 !px-3 disabled:opacity-50"
            >
              {scraping ? <Loader2 size={14} className="animate-spin" /> : <Briefcase size={14} />}
              Full pipeline
            </button>
          </div>
        </header>

        <WorkQueueBar
          filters={filters}
          onChange={setFilters}
          queueCount={queueCount}
          needsYou={pendingCount}
          readyApply={readyApply}
          scraped={scrapedCount}
          insights={insights}
          viewMode={viewMode}
          onViewMode={setViewMode}
          onPrev={() => selectRelative(-1)}
          onNext={() => selectRelative(1)}
          canPrev={selectedIndex > 0}
          canNext={selectedIndex >= 0 && selectedIndex < visibleJobs.length - 1}
          onFollowUps={() =>
            setFilters({ ...filters, status: 'applied', sort: 'newest', search: '' })
          }
          onHighInterest={() =>
            setFilters({ ...filters, status: 'ready_apply', sort: 'action', search: '' })
          }
          onExport={() => {
            downloadTextFile(
              `resumemaker-jobs-${new Date().toISOString().slice(0, 10)}.csv`,
              exportJobsCsv(jobs)
            );
            toast.success(`Exported ${jobs.length} jobs`);
          }}
          onOpenAnswers={() => setAnswersOpen(true)}
        />

        <PipelineControlPanel onJobsChanged={loadJobs} busy={controlsBusy} setBusy={setPanelBusy} />

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 shrink-0">
          {[
            {
              label: 'Total',
              value: totalJobs,
              icon: Briefcase,
              iconWrap: 'bg-mist text-ink-muted',
              onClick: () => setFilters({ ...filters, status: 'all', sort: 'priority' }),
            },
            {
              label: 'Resumes',
              value: resumesReady,
              icon: FileText,
              iconWrap: 'bg-cedar-soft text-cedar',
            },
            {
              label: 'Ready',
              value: readyApply,
              icon: Send,
              iconWrap: 'bg-emerald-50 text-emerald-700',
              onClick: () => setFilters({ ...filters, status: 'ready_apply', sort: 'newest' }),
            },
            {
              label: 'Applied',
              value: applied,
              icon: CheckCircle,
              iconWrap: 'bg-emerald-50 text-emerald-800',
              onClick: () => setFilters({ ...filters, status: 'applied', sort: 'newest' }),
            },
            {
              label: 'Needs you',
              value: pendingCount,
              icon: pendingCount > 0 ? Hand : Bell,
              iconWrap: 'bg-amber-50 text-amber-700',
              onClick: () => setFilters({ ...filters, status: 'needs_you', sort: 'action' }),
              pulse: pendingCount > 0,
            },
          ].map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className={`surface py-2.5 px-3 text-left transition-all duration-200 hover:border-cedar/20 ${
                card.pulse ? 'animate-pulse-soft ring-1 ring-amber-300/60' : ''
              } ${card.onClick ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`rounded-xl p-1.5 ${card.iconWrap}`}>
                  <card.icon size={15} strokeWidth={2.25} />
                </div>
                <div>
                  <p className="text-ink-faint text-[9px] font-semibold uppercase tracking-wide">
                    {card.label}
                  </p>
                  <p className="text-lg font-bold font-display text-ink tabular-nums leading-none">
                    {card.value}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {viewMode === 'board' ? (
          <div className="space-y-4 animate-fade-up stagger-3">
            <PipelineBoard
              jobs={visibleJobs}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMove={moveBoardJob}
            />
            {selected && (
              <div className="surface overflow-hidden min-h-[40vh] max-h-[70vh]">
                <JobDetailPanel
                  job={selected}
                  onUpdated={loadJobs}
                  onDeleted={() => setSelectedId(null)}
                  onGateComplete={advanceAfterGate}
                />
              </div>
            )}
          </div>
        ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0 items-start animate-fade-up stagger-3">
          <aside className="lg:col-span-1 surface overflow-hidden flex flex-col min-h-[50vh] lg:sticky lg:top-[1.5vh] lg:h-[97vh] lg:max-h-[97vh] lg:self-start">
            <JobFiltersBar
              filters={filters}
              onChange={setFilters}
              total={jobs.length}
              visible={visibleJobs.length}
            />
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white/40">
              {loading ? (
                <div className="p-10 text-center text-ink-muted text-sm space-y-3">
                  <Loader2 className="inline animate-spin text-cedar" size={22} />
                  <p className="font-medium">Loading jobs…</p>
                </div>
              ) : visibleJobs.length === 0 ? (
                <EmptyState
                  hasTotalJobs={jobs.length > 0}
                  onClearFilters={() => setFilters({ ...DEFAULT_FILTERS, status: 'all', sort: 'priority' })}
                  onRunPipeline={runFullPipeline}
                />
              ) : (
                <ul>
                  {visibleJobs.map((job) => {
                    const active = job._id === selectedId;
                    const applicants = jobApplicants(job);
                    const postedLabel = formatPostedOnPlatform(job);
                    const scrapedLabel = formatScrapedOn(job);
                    const ats = detectAtsUi(job.url, job.source, job.atsType);
                    const attention = needsUserAttention(job.status, job.pendingAction);
                    return (
                      <li key={job._id} className="border-b border-paper-line/60 last:border-0">
                        <button
                          type="button"
                          onClick={() => setSelectedId(job._id)}
                          className={`w-full text-left p-3.5 transition-all duration-300 ease-apple relative ${
                            active
                              ? 'bg-cedar-soft/70 border-l-[3px] border-l-cedar'
                              : 'hover:bg-mist/70 border-l-[3px] border-l-transparent'
                          } ${attention && !active ? 'bg-amber-50/50' : ''}`}
                        >
                          <p className="font-semibold text-xs text-ink line-clamp-2 leading-snug">
                            {job.title}
                          </p>
                          <p className="text-[11px] text-ink-muted font-medium mt-0.5 truncate">
                            {job.company}
                          </p>

                          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                            {job.interest ? (
                              <span className="text-[9px] text-amber-700 font-bold tracking-tight">
                                {'★'.repeat(job.interest)}
                              </span>
                            ) : null}
                            {job.priority === 'faang' && (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-950 border border-amber-200/80">
                                FAANG
                              </span>
                            )}
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold border ${ATS_BADGE_CLASS[ats.kind]}`}
                            >
                              {ats.label}
                            </span>
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-semibold capitalize ${
                                STATUS_STYLES[job.status] ||
                                'bg-slate-100 text-slate-600 border border-slate-200'
                              } ${job.status === 'pending_submit_approval' ? 'animate-pulse-soft' : ''}`}
                            >
                              {statusLabel(job.status)}
                            </span>
                            {(job.matchScore != null || job.keywordMatchScore != null) && (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-900 border border-emerald-200/80">
                                {job.matchScore ?? job.keywordMatchScore}%
                              </span>
                            )}
                          </div>

                          <div className="mt-2 space-y-0.5 text-[10px] text-ink-faint font-medium">
                            {postedLabel && (
                              <p className="flex items-center gap-1 truncate text-ink-muted">
                                <Clock size={10} className="text-cedar" /> {postedLabel}
                              </p>
                            )}
                            <p className="flex items-center gap-1 truncate">
                              <Globe size={10} className="text-cedar/70" /> {scrapedLabel}
                            </p>
                            {applicants && (
                              <p className="flex items-center gap-1 truncate text-amber-800">
                                <Users size={10} /> {applicants}
                              </p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <main className="lg:col-span-3 surface overflow-hidden min-h-[50vh] lg:sticky lg:top-[1.5vh] lg:h-[97vh] lg:max-h-[97vh] lg:self-start bg-white/80">
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center text-ink-faint p-8 text-center space-y-4 animate-fade-in">
                <div className="h-16 w-16 rounded-[1.25rem] bg-cedar-soft border border-cedar/15 flex items-center justify-center text-cedar shadow-soft">
                  <Loader2 size={28} className="animate-spin" />
                </div>
                <div className="max-w-sm space-y-1">
                  <h3 className="text-sm font-bold font-display text-ink">Loading workspace…</h3>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Fetching jobs, match scores, and apply pipeline state.
                  </p>
                </div>
              </div>
            ) : selected ? (
              <div key={selected._id} className="h-full animate-fade-in">
                <JobDetailPanel
                  job={selected}
                  onUpdated={loadJobs}
                  onDeleted={() => setSelectedId(null)}
                  onGateComplete={advanceAfterGate}
                />
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-ink-faint p-8 text-center space-y-3 animate-fade-in">
                <div className="h-16 w-16 rounded-[1.25rem] bg-mist border border-paper-line flex items-center justify-center text-ink-faint shadow-soft">
                  <Briefcase size={28} />
                </div>
                <div className="max-w-sm space-y-1">
                  <h3 className="text-sm font-bold font-display text-ink">Select a job</h3>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Pick a listing to review the resume, then apply on the career page with human
                    submit approval.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
        )}
      </div>
    </div>
  );
}

export default App;
