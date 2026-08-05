import type { Job, JobStatus } from '../types';

export type JobSource =
  | 'jobright'
  | 'linkedin'
  | 'indeed'
  | 'career_portal'
  | 'greenhouse'
  | 'lever'
  | 'github'
  | 'simplify'
  | 'company_portal'
  | 'other';

export const PLATFORM_LABELS: Record<JobSource, string> = {
  jobright: 'Jobright',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  career_portal: 'Google',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  github: 'GitHub list',
  simplify: 'Simplify',
  company_portal: 'Company portal',
  other: 'Other',
};

export function platformLabel(source?: string): string {
  if (!source) return 'Unknown';
  return PLATFORM_LABELS[source as JobSource] || source.replace(/_/g, ' ');
}

export function jobApplicants(job: Job): string | undefined {
  return job.applicants || job.linkedinApplicants;
}

export function jobPosted(job: Job): string | undefined {
  return job.posted || job.linkedinPosted;
}

export function jobPostedAt(job: Job): Date | undefined {
  if (job.postedAt) {
    const d = new Date(job.postedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return parsePostedTextToDate(jobPosted(job));
}

function parsePostedTextToDate(text?: string, referenceDate = new Date()): Date | undefined {
  if (!text?.trim()) return undefined;
  const t = text.trim().toLowerCase();
  if (t.includes('just now') || t === 'today') return new Date(referenceDate);
  if (t.includes('yesterday')) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 1);
    return d;
  }
  const rel = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const d = new Date(referenceDate);
    if (unit.startsWith('minute')) d.setMinutes(d.getMinutes() - n);
    else if (unit.startsWith('hour')) d.setHours(d.getHours() - n);
    else if (unit.startsWith('day')) d.setDate(d.getDate() - n);
    else if (unit.startsWith('week')) d.setDate(d.getDate() - n * 7);
    else if (unit.startsWith('month')) d.setMonth(d.getMonth() - n);
    else if (unit.startsWith('year')) d.setFullYear(d.getFullYear() - n);
    return d;
  }
  const cleaned = text.replace(/^(posted|reposted)\s+/i, '').trim();
  const parsed = Date.parse(cleaned);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return undefined;
}

export function formatPostedOnPlatform(job: Job): string | undefined {
  if (job.postedOnPlatform) return job.postedOnPlatform;
  const platform = platformLabel(job.platform || job.source);
  const at = jobPostedAt(job);
  if (at) {
    const date = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `Posted on ${platform}: ${date}`;
  }
  const raw = jobPosted(job);
  if (raw) return `Posted on ${platform}: ${raw}`;
  return undefined;
}

export function formatScrapedOn(job: Job): string {
  const platform = platformLabel(job.platform || job.source);
  const when = new Date(job.createdAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Scraped on ${when} · ${platform}`;
}

export type SortOption =
  | 'priority'
  | 'newest'
  | 'oldest'
  | 'company'
  | 'title'
  | 'posted_newest'
  | 'posted_oldest'
  | 'applicants_low'
  | 'applicants_high';

export interface JobFilters {
  search: string;
  source: string;
  status: string;
  priority: string;
  jobType: string;
  hasApplicants: string;
  hasPosted: string;
  sort: SortOption;
}

export const DEFAULT_FILTERS: JobFilters = {
  search: '',
  source: 'all',
  status: 'all',
  priority: 'all',
  jobType: 'fulltime',
  hasApplicants: 'all',
  hasPosted: 'all',
  sort: 'priority',
};

function parseApplicantCount(text?: string): number {
  if (!text) return 999999;
  const t = text.toLowerCase();
  if (t.includes('less than')) {
    const m = t.match(/less than\s+([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) - 1 : 10;
  }
  const m = t.match(/([\d,]+)\+?/);
  return m ? Number(m[1].replace(/,/g, '')) : 999999;
}

export function filterAndSortJobs(jobs: Job[], filters: JobFilters): Job[] {
  const q = filters.search.trim().toLowerCase();

  let list = jobs.filter((job) => {
    if (q) {
      const hay = `${job.title} ${job.company} ${job.location || ''} ${job.jobDescription}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.source !== 'all' && job.source !== filters.source) return false;
    if (filters.status === 'all') {
      // Keep closed / chrome-JD rows out of the default inbox
      if (job.status === 'invalid_job') return false;
    } else if (job.status !== filters.status) {
      return false;
    }
    if (filters.priority === 'faang' && job.priority !== 'faang') return false;
    if (filters.priority === 'standard' && job.priority === 'faang') return false;
    if (filters.jobType !== 'all' && job.jobType !== filters.jobType) return false;
    if (filters.hasApplicants === 'yes' && !jobApplicants(job)) return false;
    if (filters.hasApplicants === 'no' && jobApplicants(job)) return false;
    if (filters.hasPosted === 'yes' && !jobPosted(job) && !job.postedAt) return false;
    if (filters.hasPosted === 'no' && (jobPosted(job) || job.postedAt)) return false;
    return true;
  });

  switch (filters.sort) {
    case 'oldest':
      list = list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case 'company':
      list = list.sort((a, b) => a.company.localeCompare(b.company));
      break;
    case 'title':
      list = list.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'posted_newest':
      list = list.sort((a, b) => {
        const aT = jobPostedAt(a)?.getTime() ?? 0;
        const bT = jobPostedAt(b)?.getTime() ?? 0;
        return bT - aT;
      });
      break;
    case 'posted_oldest':
      list = list.sort((a, b) => {
        const aT = jobPostedAt(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bT = jobPostedAt(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aT - bT;
      });
      break;
    case 'applicants_low':
      list = list.sort(
        (a, b) => parseApplicantCount(jobApplicants(a)) - parseApplicantCount(jobApplicants(b))
      );
      break;
    case 'applicants_high':
      list = list.sort(
        (a, b) => parseApplicantCount(jobApplicants(b)) - parseApplicantCount(jobApplicants(a))
      );
      break;
    case 'newest':
      list = list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case 'priority':
    default:
      list = list.sort((a, b) => {
        const aPri = a.priority === 'faang' ? 0 : 1;
        const bPri = b.priority === 'faang' ? 0 : 1;
        if (aPri !== bPri) return aPri - bPri;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  return list;
}

export const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All (hide invalid)' },
  { value: 'scraped', label: 'Scraped' },
  { value: 'resume_generated', label: 'Resume generated' },
  { value: 'pdf_uploaded', label: 'PDF uploaded' },
  { value: 'applied', label: 'Applied' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'interview', label: 'Interview' },
  { value: 'confused_hold', label: 'Confused - Hold' },
  { value: 'invalid_job', label: 'Invalid job' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'failed', label: 'Failed / skipped' },
];
