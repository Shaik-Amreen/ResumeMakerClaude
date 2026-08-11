import type { Job } from '../types';
import { isNeedsYou, isReadyToApply } from './jobFilters';

export interface SearchInsights {
  appliedThisWeek: number;
  appliedToday: number;
  followUpsDue: number;
  staleApplied: number;
  highInterestReady: number;
  interviews: number;
  queue: number;
}

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number) {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

export function computeInsights(jobs: Job[]): SearchInsights {
  const week = daysAgo(7);
  const today = startOfDay();
  const now = Date.now();

  let appliedThisWeek = 0;
  let appliedToday = 0;
  let followUpsDue = 0;
  let staleApplied = 0;
  let highInterestReady = 0;
  let interviews = 0;
  let queue = 0;

  for (const j of jobs) {
    if (isNeedsYou(j) || isReadyToApply(j)) queue += 1;
    if (j.status === 'interview' || j.status === 'assessment') interviews += 1;
    if (isReadyToApply(j) && (j.interest ?? 0) >= 4) highInterestReady += 1;

    const appliedAt = j.appliedAt ? new Date(j.appliedAt) : null;
    if (j.status === 'applied' || j.status === 'assessment' || j.status === 'interview') {
      if (appliedAt && appliedAt >= week) appliedThisWeek += 1;
      if (appliedAt && appliedAt >= today) appliedToday += 1;
    }

    if (j.followUpAt) {
      const due = new Date(j.followUpAt).getTime();
      if (
        due <= now &&
        ['applied', 'assessment', 'interview', 'pdf_uploaded'].includes(j.status)
      ) {
        followUpsDue += 1;
      }
    } else if (j.status === 'applied' && appliedAt) {
      const ageDays = (now - appliedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays >= 7) staleApplied += 1;
    }
  }

  return {
    appliedThisWeek,
    appliedToday,
    followUpsDue,
    staleApplied,
    highInterestReady,
    interviews,
    queue,
  };
}

export function exportJobsCsv(jobs: Job[]): string {
  const headers = [
    'company',
    'title',
    'status',
    'interest',
    'matchScore',
    'source',
    'location',
    'url',
    'appliedAt',
    'followUpAt',
    'notes',
    'createdAt',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = jobs.map((j) =>
    [
      j.company,
      j.title,
      j.status,
      j.interest ?? '',
      j.matchScore ?? j.keywordMatchScore ?? '',
      j.source ?? '',
      j.location ?? '',
      j.url,
      j.appliedAt ?? '',
      j.followUpAt ?? '',
      j.notes ?? '',
      j.createdAt,
    ]
      .map(escape)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
