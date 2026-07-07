import type { Job, JobStatus } from './types';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';
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
  currentWindow: 'night_faang_mango' | 'morning_faang_mango' | 'fulltime_jobs' | 'idle';
  running: boolean;
  windowCompleted?: boolean;
}

export const api = {
  getJobs: () => request<Job[]>('/jobs'),
  getSchedulerStatus: () => request<SchedulerStatus>('/jobs/scheduler/status'),
  getJob: (id: string) => request<Job>(`/jobs/${id}`),
  startScraper: () => request<{ message: string }>('/jobs/scrape', { method: 'POST' }),
  refreshJobs: () => request<{ message: string }>('/jobs/refresh-jobs', { method: 'POST' }),
  resetAll: () => request<{ message: string }>('/jobs/reset-all', { method: 'POST' }),
  updateStatus: (id: string, status: JobStatus) =>
    request<Job>(`/jobs/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  uploadPdf: (id: string, file: File) => {
    const form = new FormData();
    form.append('resume', file);
    return request<Job>(`/jobs/${id}/upload-pdf`, { method: 'POST', body: form });
  },
  generateResumeOllama: (id: string) =>
    request<{ message: string }>(`/jobs/${id}/generate-resume-ollama`, { method: 'POST' }),
  submitLatex: async (id: string, latex: string) => {
    const res = await fetch(`${API}/jobs/${id}/latex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latex }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 422) {
      throw new Error(data.message || `Request failed: ${res.status}`);
    }
    if (!res.ok && data.message) {
      throw new Error(data.message);
    }
    return (data.job || data) as Job;
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
};
