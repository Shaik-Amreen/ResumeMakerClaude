import type { Job, JobStatus, JobType } from './types';

export type { JobType };

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5002/api';
export const UPLOADS_BASE = API.replace(/\/api\/?$/, '');

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface SchedulerStatus {
  enabled: boolean;
  timezone: string;
  localTime: string;
  currentWindow: 'job_cycle' | 'internship_cycle' | 'idle' | 'night_faang_mango' | 'morning_faang_mango' | 'fulltime_jobs';
  jobType?: 'fulltime';
  running: boolean;
  windowCompleted?: boolean;
  cooldownMinutesRemaining?: number;
}

export interface TaskStatus {
  active: boolean;
  task:
    | 'idle'
    | 'scraping_jobright'
    | 'scraping_linkedin'
    | 'scraping_indeed'
    | 'scraping_career_portals'
    | 'scraping_faang_portals'
    | 'scraping_github_lists'
    | 'scraping_ats'
    | 'generating_resumes'
    | 'master_pipeline'
    | 'outreach';
  phase?: string;
  message: string;
  progress?: { current: number; total: number; label?: string };
  scrapedThisRun: number;
  resumesDone: number;
  resumesTotal: number;
  lastError?: string;
  logs: string[];
  stopRequested: boolean;
  startedAt?: string;
  updatedAt: string;
}

export const api = {
  getJobs: () => request<Job[]>('/jobs'),
  getTaskStatus: () => request<TaskStatus>('/jobs/task/status'),
  stopTask: () => request<{ message: string }>('/jobs/task/stop', { method: 'POST' }),
  getSchedulerStatus: () => request<SchedulerStatus>('/jobs/scheduler/status'),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  startScraper: () => request<{ message: string }>('/jobs/scrape/career-portals', { method: 'POST' }),
  scrapeFaangPortals: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/faang-portals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  scrapeGithubLists: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/github-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  scrapeJobright: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/jobright', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  scrapeLinkedIn: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/linkedin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  scrapeIndeed: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/indeed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  scrapeCareerPortals: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/career-portals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  scrapeAts: (limit: number, jobType: JobType = 'fulltime') =>
    request<{ message: string }>('/jobs/scrape/ats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, jobType }),
    }),
  generateResumes: (opts?: { limit?: number; withOutreach?: boolean }) =>
    request<{ message: string }>('/jobs/generate-resumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    }),
  deleteAll: () => request<{ message: string; deleted: number }>('/jobs/delete-all', { method: 'POST' }),
  deleteJob: (id: string) =>
    request<{ message: string; deleted: boolean }>(`/jobs/${id}`, { method: 'DELETE' }),
  runPipeline: (opts?: { deleteFirst?: boolean; perSourceCap?: number; jobType?: 'internship' | 'fulltime' }) =>
    request<{ message: string }>('/jobs/run-pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    }),
  refreshJobs: () => request<{ message: string }>('/jobs/refresh-jobs', { method: 'POST' }),
  resetAll: () => request<{ message: string }>('/jobs/reset-all', { method: 'POST' }),
  updateStatus: (id: string, status: JobStatus) =>
    request<Job>(`/jobs/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  updateJobDescription: (id: string, jobDescription: string, regenerate = true) =>
    request<{ job: Job; message: string }>(`/jobs/${id}/job-description`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription, regenerate }),
    }),
  uploadPdf: (id: string, file: File) => {
    const form = new FormData();
    form.append('resume', file);
    return request<Job>(`/jobs/${id}/upload-pdf`, { method: 'POST', body: form });
  },
  generateResumeOllama: (id: string) =>
    request<{ message: string }>(`/jobs/${id}/generate-resume-ollama`, { method: 'POST' }),
  refreshMatchScore: (id: string) =>
    request<{
      resumeMatchScore: number;
      keywordMatchScore: number;
      matchedKeywords: string[];
      missingKeywords: string[];
      skillGaps?: string[];
      whyNot100?: string | null;
      keywords: string[];
      job: Job;
    }>(`/jobs/${id}/match-score`),
  submitLatex: async (
    id: string,
    latex: string
  ): Promise<{ job: Job; warning?: string; pageCount?: number }> => {
    const res = await fetch(`${API}/jobs/${id}/latex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    });
    const data = await res.json().catch(() => ({}));
    const job = (data.job || (data._id ? data : null)) as Job | null;
    if (!job) {
      throw new Error(data.message || `Request failed: ${res.status}`);
    }
    return {
      job,
      warning:
        typeof data.warning === 'string'
          ? data.warning
          : !res.ok && typeof data.message === 'string'
            ? data.message
            : undefined,
      pageCount: typeof data.pageCount === 'number' ? data.pageCount : undefined,
    };
  },
  approveResume: (id: string) =>
    request<Job>(`/jobs/${id}/approve-resume`, { method: 'POST' }),
  approveResumeAndApply: (id: string) =>
    request<{ message: string; job: Job }>(`/jobs/${id}/approve-resume-and-apply`, {
      method: 'POST',
    }),
  apply: (id: string) => request<{ message: string }>(`/jobs/${id}/apply`, { method: 'POST' }),
  approveMessage: (id: string, message?: string) =>
    request<Job>(`/jobs/${id}/approve-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
  approveSubmit: (id: string) => request<Job>(`/jobs/${id}/approve-submit`, { method: 'POST' }),
  reject: (id: string, reason?: string) =>
    request<Job>(`/jobs/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),

  getResumeProvider: () => request<{ provider: string }>('/resume/provider'),

  resumeFromPaste: (body: {
    resumeText: string;
    jobDescription?: string;
    title?: string;
    company?: string;
    jobType?: JobType;
  }) =>
    request<{
      provider: string;
      latex: string;
      matchScore?: number;
      matchedKeywords?: string[];
      missingKeywords?: string[];
      latexChars: number;
      resumeChars: number;
    }>('/resume/from-paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  resumePasteChat: (body: {
    latex: string;
    message: string;
    jobDescription?: string;
    title?: string;
    company?: string;
    jobType?: JobType;
  }) =>
    request<{ provider: string; latex: string; latexChars: number }>('/resume/paste-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  compileResumeLatex: (latex: string) =>
    request<{ pdfUrl: string; pageCount: number; warning?: string }>('/resume/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    }),
};
