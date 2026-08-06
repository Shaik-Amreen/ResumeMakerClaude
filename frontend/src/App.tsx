import { useCallback, useEffect, useMemo, useState } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import {
  Briefcase,
  FileText,
  CheckCircle,
  Search,
  Bell,
  Loader2,
  Users,
  Clock,
  Globe,
} from 'lucide-react';
import { JobDetailPanel } from './components/JobDetailPanel';
import { JobFiltersBar } from './components/JobFiltersBar';
import { PipelineControlPanel } from './components/PipelineControlPanel';
import { Background3D } from './components/Background3D';
import { EmptyState } from './components/EmptyState';
import { useConfirm } from './components/ConfirmProvider';
import { api, type SchedulerStatus } from './api';
import type { Job } from './types';
import {
  DEFAULT_FILTERS,
  filterAndSortJobs,
  formatPostedOnPlatform,
  formatScrapedOn,
  jobApplicants,
  type JobFilters,
} from './utils/jobFilters';

const WINDOW_LABELS: Record<string, string> = {
  job_cycle: '24/7 · Full-time / new-grad only (FAANG → GitHub/Simplify → Jobright → LinkedIn → Indeed → Google → ATS → resumes)',
  internship_cycle: 'Legacy — internships disabled',
  night_faang_mango: 'Legacy window label',
  morning_faang_mango: 'Legacy window label',
  fulltime_jobs: 'Legacy window label',
  idle: 'Idle / cooldown',
};

const STATUS_STYLES: Record<string, string> = {
  scraped: 'bg-slate-100 text-slate-700 border border-slate-200',
  resume_generating: 'bg-violet-100 text-violet-800 border border-violet-200',
  resume_generated: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  pending_resume_approval: 'bg-amber-100 text-amber-800 border border-amber-200',
  pdf_uploaded: 'bg-sky-100 text-sky-800 border border-sky-200',
  applying: 'bg-indigo-100 text-indigo-800 border border-indigo-200',
  pending_message_approval: 'bg-orange-100 text-orange-800 border border-orange-200',
  pending_submit_approval: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  applied: 'bg-green-100 text-green-800 border border-green-200',
  assessment: 'bg-cyan-100 text-cyan-900 border border-cyan-200',
  interview: 'bg-blue-100 text-blue-900 border border-blue-200',
  confused_hold: 'bg-amber-50 text-amber-900 border border-amber-300',
  invalid_job: 'bg-rose-100 text-rose-900 border border-rose-200',
  accepted: 'bg-lime-100 text-lime-900 border border-lime-300',
  failed: 'bg-red-100 text-red-800 border border-red-200',
};

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    confused_hold: 'Confused - Hold',
    invalid_job: 'Invalid job',
    assessment: 'Assessment',
    interview: 'Interview',
    accepted: 'Accepted',
    pending_resume_approval: 'Pending resume approval',
    resume_generating: 'Resume generating',
    resume_generated: 'Resume generated',
    pdf_uploaded: 'PDF uploaded',
  };
  return labels[status] || status.replace(/_/g, ' ');
}

function App() {
  const confirm = useConfirm();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS);
  const [panelBusy, setPanelBusy] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setJobs(data);
      setSelectedId((prev) => {
        if (prev && data.some((j) => j._id === prev)) return prev;
        return data[0]?._id ?? null;
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

  const selected = visibleJobs.find((j) => j._id === selectedId) ?? jobs.find((j) => j._id === selectedId) ?? null;

  const pendingCount = jobs.filter((j) => j.pendingAction).length;
  const totalJobs = jobs.length;
  const resumesReady = jobs.filter((j) =>
    ['resume_generated', 'pending_resume_approval', 'pdf_uploaded', 'applied'].includes(j.status)
  ).length;
  const applied = jobs.filter((j) => j.status === 'applied').length;

  const startScraper = async () => {
    setPanelBusy(true);
    try {
      await api.runPipeline({ deleteFirst: false, perSourceCap: 50, jobType: 'fulltime' });
      toast.success('Scraper started');
      loadJobs();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scraper failed to start');
    } finally {
      setPanelBusy(false);
    }
  };

  const runFullPipeline = async () => {
    const ok = await confirm({
      title: 'Run Full Pipeline?',
      message: 'Run full pipeline (FAANG → GitHub → Jobright → LinkedIn → Indeed → Google → ATS, up to 50 new jobs, then resumes)? Existing jobs are kept.',
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

  return (
    <div className="min-h-screen bg-paper text-ink relative font-sans flex flex-col">
      <ToastContainer position="top-right" autoClose={3500} theme="colored" />
      <Background3D />

      <div className="relative z-10 flex flex-col flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 gap-4 min-h-0">
        <header className="shrink-0 flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4">
          <div>
            <p className="text-primary-500 text-sm font-medium tracking-widest uppercase mb-1">
              Karthik · Full-time / new-grad only
            </p>
            <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-ink via-primary-500 to-sky-500">
              AI Job Tracker
            </h1>
            <p className="text-ink-muted text-sm mt-1 max-w-xl">
              Scrape FAANG, GitHub, Simplify, Jobright, LinkedIn, Indeed, Google Jobs, or ATS for
              full-time / new-grad SWE roles only — internships are skipped. Live status updates below.
            </p>
            {scheduler && (
              <p className="text-xs text-primary-500 mt-2">
                Scheduler {scheduler.enabled ? 'on' : 'off'} · {scheduler.localTime} PT ·{' '}
                {WINDOW_LABELS[scheduler.currentWindow]}
                {scheduler.running ? ' · scraping…' : scheduler.windowCompleted ? ' · done for this window' : ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
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
              className="glass px-4 py-2 rounded-xl text-sm text-ink-muted hover:bg-slate-50 hover:text-ink disabled:opacity-50"
            >
              Reset All
            </button>
            <button
              onClick={refreshListings}
              disabled={controlsBusy}
              className="glass px-4 py-2 rounded-xl text-sm text-ink-muted hover:bg-sky-50 hover:text-sky-800 hover:border-sky-200 disabled:opacity-50"
            >
              Refresh Listings
            </button>
            <button
              onClick={runFullPipeline}
              disabled={controlsBusy}
              className="px-4 py-2 rounded-xl text-sm bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-2 disabled:opacity-50 font-medium shadow-sm"
            >
              {scraping ? <Loader2 size={16} className="animate-spin" /> : <Briefcase size={16} />}
              Run Full Pipeline
            </button>
            <button
              onClick={startScraper}
              disabled={controlsBusy}
              className="px-4 py-2 rounded-xl text-sm bg-primary-500 text-white border border-primary-500 hover:bg-accent-hover flex items-center gap-2 disabled:opacity-50 shadow-sm"
            >
              {scraping ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Scrape Indeed
            </button>
          </div>
        </header>

        <PipelineControlPanel onJobsChanged={loadJobs} busy={controlsBusy} setBusy={setPanelBusy} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="glass rounded-2xl py-3.5 px-4 border-l-4 border-l-sky-500 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-sky-50 p-2 text-sky-600 border border-sky-100 shadow-2xs">
                <Briefcase size={20} />
              </div>
              <div>
                <p className="text-slate-500 text-xs font-medium">Total Jobs</p>
                <p className="text-xl font-bold text-slate-900 tracking-tight">{totalJobs}</p>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl py-3.5 px-4 border-l-4 border-l-teal-500 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-teal-50 p-2 text-teal-600 border border-teal-100 shadow-2xs">
                <FileText size={20} />
              </div>
              <div>
                <p className="text-slate-500 text-xs font-medium">Resumes Ready</p>
                <p className="text-xl font-bold text-slate-900 tracking-tight">{resumesReady}</p>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl py-3.5 px-4 border-l-4 border-l-emerald-500 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600 border border-emerald-100 shadow-2xs">
                <CheckCircle size={20} />
              </div>
              <div>
                <p className="text-slate-500 text-xs font-medium">Applied</p>
                <p className="text-xl font-bold text-slate-900 tracking-tight">{applied}</p>
              </div>
            </div>
          </div>

          <div className="glass rounded-2xl py-3.5 px-4 border-l-4 border-l-amber-500 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-50 p-2 text-amber-600 border border-amber-100 shadow-2xs">
                <Bell size={20} />
              </div>
              <div>
                <p className="text-slate-500 text-xs font-medium">Pending Review</p>
                <p className="text-xl font-bold text-slate-900 tracking-tight">{pendingCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0 items-start">
          <aside className="lg:col-span-1 glass rounded-2xl flex flex-col overflow-hidden min-h-[50vh] lg:sticky lg:top-[1.5vh] lg:h-[97vh] lg:max-h-[97vh] lg:self-start border border-slate-200/80 shadow-xs">
            <JobFiltersBar
              filters={filters}
              onChange={setFilters}
              total={jobs.length}
              visible={visibleJobs.length}
            />
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white/60">
              {loading ? (
                <div className="p-8 text-center text-slate-500 text-sm space-y-2">
                  <Loader2 className="inline animate-spin text-teal-600" size={24} />
                  <p className="font-medium">Loading jobs database…</p>
                </div>
              ) : visibleJobs.length === 0 ? (
                <EmptyState
                  hasTotalJobs={jobs.length > 0}
                  onClearFilters={() => setFilters(DEFAULT_FILTERS)}
                  onRunPipeline={runFullPipeline}
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visibleJobs.map((job) => {
                    const active = job._id === selectedId;
                    const applicants = jobApplicants(job);
                    const postedLabel = formatPostedOnPlatform(job);
                    const scrapedLabel = formatScrapedOn(job);
                    return (
                      <li key={job._id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(job._id)}
                          className={`w-full text-left p-3.5 transition-all duration-150 relative ${
                            active
                              ? 'bg-gradient-to-r from-teal-50/90 to-sky-50/60 border-l-4 border-l-teal-600 shadow-2xs font-semibold'
                              : 'hover:bg-slate-50/80 border-l-4 border-l-transparent'
                          }`}
                        >
                          <p className="font-semibold text-xs text-slate-900 line-clamp-2 leading-snug">{job.title}</p>
                          <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">{job.company}</p>

                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {job.priority === 'faang' && (
                              <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300/70 shadow-2xs">
                                FAANG/MANGO
                              </span>
                            )}
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-semibold capitalize ${
                                STATUS_STYLES[job.status] || 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}
                            >
                              {statusLabel(job.status)}
                            </span>
                            {(job.matchScore != null || job.keywordMatchScore != null) && (
                              <span className="inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs">
                                {job.matchScore ?? job.keywordMatchScore}% match
                              </span>
                            )}
                          </div>

                          <div className="mt-2 space-y-0.5 text-[10px] text-slate-400 font-medium">
                            {postedLabel && (
                              <p className="flex items-center gap-1 truncate text-slate-500">
                                <Clock size={10} className="text-teal-600" /> {postedLabel}
                              </p>
                            )}
                            <p className="flex items-center gap-1 truncate">
                              <Globe size={10} className="text-sky-600" /> {scrapedLabel}
                            </p>
                            {applicants && (
                              <p className="flex items-center gap-1 truncate text-amber-700">
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

          <main className="lg:col-span-3 glass rounded-2xl overflow-hidden min-h-[50vh] lg:sticky lg:top-[1.5vh] lg:h-[97vh] lg:max-h-[97vh] lg:self-start bg-white/95 border border-slate-200/80 shadow-xs">
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center space-y-4">
                <div className="h-16 w-16 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shadow-2xs">
                  <Loader2 size={32} className="animate-spin" />
                </div>
                <div className="max-w-sm space-y-1">
                  <h3 className="text-sm font-bold text-slate-800">Loading Job Database...</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Fetching latest jobs, keyword match scores, and resume pipeline state.
                  </p>
                </div>
              </div>
            ) : selected ? (
              <JobDetailPanel
                job={selected}
                onUpdated={loadJobs}
                onDeleted={() => setSelectedId(null)}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center space-y-3">
                <div className="h-16 w-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 shadow-2xs">
                  <Briefcase size={32} />
                </div>
                <div className="max-w-sm space-y-1">
                  <h3 className="text-sm font-bold text-slate-700">Select a Job Listing</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Click any job from the left sidebar to view match score breakdowns, edit job descriptions, and generate or recompile tailored LaTeX resumes.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
