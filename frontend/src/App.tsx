import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api, type SchedulerStatus } from './api';
import type { Job, JobType } from './types';
import {
  DEFAULT_FILTERS,
  filterAndSortJobs,
  formatPostedOnPlatform,
  formatScrapedOn,
  jobApplicants,
  type JobFilters,
} from './utils/jobFilters';

const WINDOW_LABELS: Record<string, string> = {
  internship_cycle: '24/7 · Full-time / new-grad (Jobright → LinkedIn → Indeed → resumes → Easy Apply)',
  night_faang_mango: '11 PM–8 AM · FAANG + MANGOES full-time',
  morning_faang_mango: '9–11 AM · FAANG + MANGOES full-time',
  fulltime_jobs: '8–9 AM & 11 AM–11 PM · full-time',
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS);
  const [panelBusy, setPanelBusy] = useState(false);
  const [jobType, setJobType] = useState<JobType>('fulltime');

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
      if (jobType === 'fulltime') {
        await api.scrapeIndeed(50, 'fulltime');
      } else {
        await api.scrapeCareerPortals(50);
      }
      loadJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Scraper failed to start');
    } finally {
      setPanelBusy(false);
    }
  };

  const runFullPipeline = async () => {
    if (
      !confirm(
        'Run full pipeline (scrape up to 50 new jobs across sources, then generate resumes)? Existing jobs are kept — nothing will be deleted.'
      )
    ) {
      return;
    }
    setPanelBusy(true);
    try {
      const r = await api.runPipeline({ deleteFirst: false, perSourceCap: 50, jobType });
      alert(r.message);
      loadJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Pipeline failed to start');
    } finally {
      setPanelBusy(false);
    }
  };

  const refreshListings = async () => {
    setPanelBusy(true);
    try {
      await api.refreshJobs();
      alert('Refreshing posted dates & applicant counts for all jobs.');
      loadJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setPanelBusy(false);
    }
  };

  const controlsBusy = scraping || panelBusy;

  return (
    <div className="min-h-screen bg-paper text-ink relative font-sans flex flex-col">
      <Background3D />

      <div className="relative z-10 flex flex-col flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 gap-4 min-h-0">
        <header className="shrink-0 flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <label className="text-xs uppercase tracking-widest text-ink-faint">Job search mode</label>
              <select
                value={jobType}
                onChange={(e) => {
                  const next = e.target.value as JobType;
                  setJobType(next);
                  setFilters((f) => ({ ...f, jobType: next }));
                }}
                disabled={controlsBusy}
                className="rounded-xl bg-white border border-teal-200 px-4 py-2 text-sm text-ink shadow-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 min-w-[220px]"
              >
                <option value="fulltime">Full-time / new grad</option>
                <option value="internship">Internships (legacy)</option>
              </select>
            </div>
            <p className="text-primary-500 text-sm font-medium tracking-widest uppercase mb-1">
              Karthik · Job Command Center
            </p>
            <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-ink via-primary-500 to-sky-500">
              AI Job Tracker
            </h1>
            <p className="text-ink-muted text-sm mt-1 max-w-xl">
              Scrape Jobright, LinkedIn, or Google Jobs separately — set how many jobs, then generate
              resumes one by one. Live status updates below.
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
                if (!confirm('Reset ALL jobs to Scraped? Clears PDFs and LaTeX.')) return;
                setScraping(true);
                try {
                  const r = await api.resetAll();
                  alert(r.message);
                  loadJobs();
                } catch (e) {
                  alert(e instanceof Error ? e.message : 'Reset failed');
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
              {jobType === 'internship' ? 'Scrape FAANG + MANGOES' : 'Scrape Indeed'}
            </button>
          </div>
        </header>

        <PipelineControlPanel
          jobType={jobType}
          onJobsChanged={loadJobs}
          busy={controlsBusy}
          setBusy={setPanelBusy}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="glass-card py-3 px-4 border-l-4 border-l-sky-400">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-sky-100 p-2">
                <Briefcase size={18} className="text-sky-600" />
              </div>
              <div>
                <p className="text-ink-faint text-xs">Jobs</p>
                <p className="text-lg font-bold text-ink">{totalJobs}</p>
              </div>
            </div>
          </div>
          <div className="glass-card py-3 px-4 border-l-4 border-l-violet-400">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-violet-100 p-2">
                <FileText size={18} className="text-violet-600" />
              </div>
              <div>
                <p className="text-ink-faint text-xs">Resumes ready</p>
                <p className="text-lg font-bold text-ink">{resumesReady}</p>
              </div>
            </div>
          </div>
          <div className="glass-card py-3 px-4 border-l-4 border-l-emerald-400">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2">
                <CheckCircle size={18} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-ink-faint text-xs">Applied</p>
                <p className="text-lg font-bold text-ink">{applied}</p>
              </div>
            </div>
          </div>
          <div className="glass-card py-3 px-4 border-l-4 border-l-amber-400">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-100 p-2">
                <Bell size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-ink-faint text-xs">Pending</p>
                <p className="text-lg font-bold text-ink">{pendingCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0 items-start">
          <aside className="lg:col-span-1 glass rounded-2xl flex flex-col overflow-hidden min-h-[50vh] lg:sticky lg:top-[1.5vh] lg:h-[97vh] lg:max-h-[97vh] lg:self-start">
            <JobFiltersBar
              filters={filters}
              onChange={setFilters}
              total={jobs.length}
              visible={visibleJobs.length}
            />
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white/60">
              {loading ? (
                <p className="p-6 text-center text-ink-muted text-sm">
                  <Loader2 className="inline animate-spin mr-2" size={16} />
                  Loading...
                </p>
              ) : visibleJobs.length === 0 ? (
                <p className="p-6 text-center text-ink-faint text-sm">
                  {jobs.length === 0 ? 'No jobs yet. Run scraper.' : 'No jobs match your filters.'}
                </p>
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
                          className={`w-full text-left p-3 transition-colors hover:bg-teal-50/70 ${
                            active ? 'bg-primary-100/70 border-l-2 border-primary-500' : ''
                          }`}
                        >
                          <p className="font-medium text-sm text-ink line-clamp-2 leading-snug">{job.title}</p>
                          <p className="text-xs text-ink-muted mt-0.5 truncate">{job.company}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {job.priority === 'faang' && (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                FAANG/MANGO
                              </span>
                            )}
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                                STATUS_STYLES[job.status] || 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}
                            >
                              {statusLabel(job.status)}
                            </span>
                            {(job.matchScore != null || job.keywordMatchScore != null) && (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                                {job.matchScore ?? job.keywordMatchScore}% match
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 space-y-0.5 text-[10px] text-ink-faint">
                            {postedLabel && (
                              <p className="flex items-center gap-1 truncate">
                                <Clock size={10} /> {postedLabel}
                              </p>
                            )}
                            <p className="flex items-center gap-1 truncate">
                              <Globe size={10} /> {scrapedLabel}
                            </p>
                            {applicants && (
                              <p className="flex items-center gap-1 truncate">
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

          <main className="lg:col-span-3 glass rounded-2xl overflow-hidden min-h-[50vh] lg:sticky lg:top-[1.5vh] lg:h-[97vh] lg:max-h-[97vh] lg:self-start bg-white/95">
            {selected ? (
              <JobDetailPanel
                job={selected}
                onUpdated={loadJobs}
                onDeleted={() => setSelectedId(null)}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-ink-faint p-8 text-center">
                <p>Select a job from the list to view details, copy JD, and upload your resume.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
