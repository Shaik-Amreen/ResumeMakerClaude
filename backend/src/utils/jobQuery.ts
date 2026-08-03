import path from 'path';
import type { IJob } from '../models/Job';
import { resolvePostedAt } from './parsePostedDate';

export type JobRecord = Pick<
  IJob,
  | 'title'
  | 'company'
  | 'location'
  | 'jobDescription'
  | 'source'
  | 'status'
  | 'priority'
  | 'jobType'
  | 'createdAt'
> & {
  applicants?: string;
  posted?: string;
  postedAt?: Date | string;
  linkedinApplicants?: string;
  linkedinPosted?: string;
};

export type JobSource = 'jobright' | 'linkedin' | 'indeed' | 'career_portal' | 'greenhouse' | 'lever' | 'other';

export function jobApplicants(job: {
  applicants?: string;
  linkedinApplicants?: string;
}): string | undefined {
  return job.applicants || job.linkedinApplicants || undefined;
}

export function jobPosted(job: { posted?: string; linkedinPosted?: string }): string | undefined {
  return job.posted || job.linkedinPosted || undefined;
}

export function jobPostedAt(job: {
  posted?: string;
  postedAt?: Date | string;
  linkedinPosted?: string;
  createdAt?: Date | string;
}): Date | undefined {
  return resolvePostedAt(
    jobPosted(job),
    job.postedAt,
    job.createdAt ? new Date(job.createdAt) : new Date()
  );
}

export function normalizeJob<T extends Record<string, unknown>>(job: T): T & {
  applicants?: string;
  posted?: string;
  postedAt?: string;
  platform: string;
  postedOnPlatform?: string;
} {
  const applicants = jobApplicants(job as Parameters<typeof jobApplicants>[0]);
  const posted = jobPosted(job as Parameters<typeof jobPosted>[0]);
  const platform = platformLabel(job.source as string);
  const at = jobPostedAt({
    posted,
    postedAt: job.postedAt as Date | string | undefined,
    linkedinPosted: job.linkedinPosted as string | undefined,
    createdAt: job.createdAt as Date | string | undefined,
  });
  const postedAt = at?.toISOString();
  const postedOnPlatform = at
    ? `Posted on ${platform}: ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : posted
      ? `Posted on ${platform}: ${posted}`
      : undefined;

  const pdfPath = job.pdfPath as string | undefined;
  const pdfUrl = pdfPath ? `/uploads/${path.basename(pdfPath)}` : undefined;

  return {
    ...job,
    applicants,
    posted,
    postedAt,
    platform,
    postedOnPlatform,
    pdfUrl,
  };
}

export const PLATFORM_LABELS: Record<JobSource, string> = {
  jobright: 'Jobright',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  career_portal: 'Google',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  other: 'Other',
};

export function platformLabel(source?: string): string {
  if (!source) return 'Unknown';
  return PLATFORM_LABELS[source as JobSource] || source;
}

/** Lower = more recent / fewer applicants for sorting */
export function parsePostedDays(text?: string): number {
  if (!text) return 9999;
  const t = text.toLowerCase();
  const m = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (!m) return 5000;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit.startsWith('minute')) return n / (24 * 60);
  if (unit.startsWith('hour')) return n / 24;
  if (unit.startsWith('day')) return n;
  if (unit.startsWith('week')) return n * 7;
  if (unit.startsWith('month')) return n * 30;
  if (unit.startsWith('year')) return n * 365;
  return 5000;
}

export function parseApplicantCount(text?: string): number {
  if (!text) return 999999;
  const t = text.toLowerCase();
  if (t.includes('less than')) {
    const m = t.match(/less than\s+([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) - 1 : 10;
  }
  if (t.includes('over')) {
    const m = t.match(/over\s+([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) + 1 : 1000;
  }
  const m = t.match(/([\d,]+)\+?/);
  return m ? Number(m[1].replace(/,/g, '')) : 999999;
}

export function sortJobs(jobs: JobRecord[], sortBy: string): JobRecord[] {
  const list = [...jobs];
  switch (sortBy) {
    case 'oldest':
      return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'company':
      return list.sort((a, b) => a.company.localeCompare(b.company));
    case 'title':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'posted_newest':
      return list.sort((a, b) => {
        const aT = jobPostedAt(a)?.getTime() ?? parsePostedDays(jobPosted(a)) * 86400000;
        const bT = jobPostedAt(b)?.getTime() ?? parsePostedDays(jobPosted(b)) * 86400000;
        return bT - aT;
      });
    case 'posted_oldest':
      return list.sort((a, b) => {
        const aT = jobPostedAt(a)?.getTime() ?? parsePostedDays(jobPosted(a)) * 86400000;
        const bT = jobPostedAt(b)?.getTime() ?? parsePostedDays(jobPosted(b)) * 86400000;
        return aT - bT;
      });
    case 'applicants_low':
      return list.sort(
        (a, b) => parseApplicantCount(jobApplicants(a)) - parseApplicantCount(jobApplicants(b))
      );
    case 'applicants_high':
      return list.sort(
        (a, b) => parseApplicantCount(jobApplicants(b)) - parseApplicantCount(jobApplicants(a))
      );
    case 'priority':
      return list.sort((a, b) => {
        const aPri = a.priority === 'faang' ? 0 : 1;
        const bPri = b.priority === 'faang' ? 0 : 1;
        if (aPri !== bPri) return aPri - bPri;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    case 'newest':
    default:
      return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export function filterJobs(
  jobs: JobRecord[],
  opts: {
    q?: string;
    source?: string;
    status?: string;
    priority?: string;
    jobType?: string;
    hasApplicants?: string;
    hasPosted?: string;
  }
): JobRecord[] {
  const q = (opts.q || '').trim().toLowerCase();

  return jobs.filter((job) => {
    if (q) {
      const hay = `${job.title} ${job.company} ${job.location || ''} ${job.jobDescription}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (opts.source && opts.source !== 'all' && job.source !== opts.source) return false;
    if (opts.status && opts.status !== 'all' && job.status !== opts.status) return false;
    if (opts.priority === 'faang' && job.priority !== 'faang') return false;
    if (opts.priority === 'standard' && job.priority === 'faang') return false;
    if (opts.jobType && opts.jobType !== 'all' && job.jobType !== opts.jobType) return false;
    if (opts.hasApplicants === 'yes' && !jobApplicants(job)) return false;
    if (opts.hasApplicants === 'no' && jobApplicants(job)) return false;
    if (opts.hasPosted === 'yes' && !jobPosted(job) && !job.postedAt) return false;
    if (opts.hasPosted === 'no' && (jobPosted(job) || job.postedAt)) return false;
    return true;
  });
}
