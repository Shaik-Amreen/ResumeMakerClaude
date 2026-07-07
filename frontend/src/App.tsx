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
import { Background3D } from './components/Background3D';
import { JobDetailPanel } from './components/JobDetailPanel';
import { JobFiltersBar } from './components/JobFiltersBar';
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

const WINDOW_LABELS: Record<SchedulerStatus['currentWindow'], string> = {
  night_faang_mango: '11 PM–8 AM · FAANG + MANGOES internships',
  morning_faang_mango: '9–11 AM · FAANG + MANGOES internships',
  fulltime_jobs: '8–9 AM & 11 AM–11 PM · full-time (Jobright → LinkedIn → Indeed)',
  idle: 'Idle',
};

const STATUS_STYLES: Record<string, string> = {
  scraped: 'bg-slate-500/20 text-slate-300',
  resume_generating: 'bg-purple-500/20 text-purple-300',
  resume_generated: 'bg-yellow-500/20 text-yellow-300',
  pending_resume_approval: 'bg-amber-500/20 text-amber-300',
  pdf_uploaded: 'bg-blue-500/20 text-blue-300',
  applying: 'bg-indigo-500/20 text-indigo-300',
  pending_message_approval: 'bg-orange-500/20 text-orange-300',
  pending_submit_approval: 'bg-emerald-500/20 text-emerald-300',
  applied: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
};

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_FILTERS);

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
    setScraping(true);
    try {
      await api.startScraper();
      alert('Scraping FAANG + MANGOES career portals. Orange Chrome must stay open.');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Scraper failed to start');
    } finally {
      setScraping(false);
    }
  };

  const refreshListings = async () => {
    setScraping(true);
    try {
      await api.refreshJobs();
      alert('Refreshing posted dates & applicant counts for all jobs.');
      loadJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 text-white relative font-sans flex flex-col">
      <Background3D />

      <div className="relative z-10 flex flex-col flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 gap-4 min-h-0">
        <header className="shrink-0 flex flex-col lg:flex-row lg:justify-between lg:items-end gap-4">
          <div>
            <p className="text-primary-400 text-sm font-medium tracking-widest uppercase mb-1">
              Amreen · Job Command Center
            </p>
            <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-primary-400 to-purple-400">
              AI Job Tracker
            </h1>
            <p className="text-gray-400 text-sm mt-1 max-w-xl">
              Internships from FAANG/MANGOES career portals. Full-time roles from Jobright, LinkedIn,
              and Indeed during daytime hours. FAANG/MANGO matches emailed instantly.
            </p>
            {scheduler && (
              <p className="text-xs text-primary-300/90 mt-2">
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
              disabled={scraping}
              className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 border-white/20 disabled:opacity-50"
            >
              Reset All
            </button>
            <button
              onClick={refreshListings}
              disabled={scraping}
              className="glass px-4 py-2 rounded-xl text-sm hover:bg-white/10 border-white/20 disabled:opacity-50"
            >
              Refresh Listings
            </button>
            <button
              onClick={startScraper}
              disabled={scraping}
              className="glass px-4 py-2 rounded-xl text-sm hover:bg-primary-500/20 border-primary-500/30 flex items-center gap-2 disabled:opacity-50"
            >
              {scraping ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              Scrape FAANG + MANGOES
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
          <div className="glass-card py-3 px-4">
            <div className="flex items-center gap-3">
              <Briefcase size={18} className="text-blue-400" />
              <div>
                <p className="text-gray-500 text-xs">Jobs</p>
                <p className="text-lg font-bold">{totalJobs}</p>
              </div>
            </div>
          </div>
          <div className="glass-card py-3 px-4">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-purple-400" />
              <div>
                <p className="text-gray-500 text-xs">Resumes ready</p>
                <p className="text-lg font-bold">{resumesReady}</p>
              </div>
            </div>
          </div>
          <div className="glass-card py-3 px-4">
            <div className="flex items-center gap-3">
              <CheckCircle size={18} className="text-green-400" />
              <div>
                <p className="text-gray-500 text-xs">Applied</p>
                <p className="text-lg font-bold">{applied}</p>
              </div>
            </div>
          </div>
          <div className="glass-card py-3 px-4">
            <div className="flex items-center gap-3">
              <Bell size={18} className="text-amber-400" />
              <div>
                <p className="text-gray-500 text-xs">Pending</p>
                <p className="text-lg font-bold">{pendingCount}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
          <aside className="lg:col-span-1 glass rounded-2xl border border-white/10 flex flex-col overflow-hidden min-h-[280px] lg:min-h-0">
            <JobFiltersBar
              filters={filters}
              onChange={setFilters}
              total={jobs.length}
              visible={visibleJobs.length}
            />
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="p-6 text-center text-gray-400 text-sm">
                  <Loader2 className="inline animate-spin mr-2" size={16} />
                  Loading...
                </p>
              ) : visibleJobs.length === 0 ? (
                <p className="p-6 text-center text-gray-500 text-sm">
                  {jobs.length === 0 ? 'No jobs yet. Run scraper.' : 'No jobs match your filters.'}
                </p>
              ) : (
                <ul className="divide-y divide-white/5">
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
                          className={`w-full text-left p-3 transition-colors hover:bg-white/5 ${
                            active ? 'bg-primary-500/15 border-l-2 border-primary-400' : ''
                          }`}
                        >
                          <p className="font-medium text-sm line-clamp-2 leading-snug">{job.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{job.company}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {job.priority === 'faang' && (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/25 text-amber-300 border border-amber-500/40">
                                FAANG/MANGO
                              </span>
                            )}
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${
                                STATUS_STYLES[job.status] || 'bg-white/10 text-gray-300'
                              }`}
                            >
                              {statusLabel(job.status)}
                            </span>
                          </div>
                          <div className="mt-1.5 space-y-0.5 text-[10px] text-gray-500">
                            {postedLabel && (
                              <p className="flex items-center gap-1 truncate">
                                <Clock size={10} /> {postedLabel}
                              </p>
                            )}
                            <p className="flex items-center gap-1 truncate text-gray-600">
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

          <main className="lg:col-span-3 glass rounded-2xl border border-white/10 overflow-hidden min-h-[400px] lg:min-h-0">
            {selected ? (
              <JobDetailPanel job={selected} onUpdated={loadJobs} />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 p-8 text-center">
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
