/**
 * Detect the ATS / apply surface from a job URL.
 * Career-page apply routes on this — LinkedIn Easy Apply is a separate fallback.
 */

export type AtsType =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'linkedin'
  | 'indeed'
  | 'unknown';

export interface AtsDetection {
  ats: AtsType;
  /** True when we have (or plan) a dedicated career-page adapter. */
  isCareerPage: boolean;
  label: string;
}

const CAREER_ATS: ReadonlySet<AtsType> = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'unknown',
]);

export function detectAts(url: string, source?: string): AtsDetection {
  const u = (url || '').trim();
  const lower = u.toLowerCase();

  if (/linkedin\.com\/(jobs|job)/i.test(lower)) {
    return { ats: 'linkedin', isCareerPage: false, label: 'LinkedIn Easy Apply' };
  }
  if (/indeed\.com/i.test(lower) || source === 'indeed') {
    return { ats: 'indeed', isCareerPage: true, label: 'Indeed' };
  }
  if (
    /greenhouse\.io/i.test(lower) ||
    /job-boards\.greenhouse\.io/i.test(lower) ||
    source === 'greenhouse'
  ) {
    return { ats: 'greenhouse', isCareerPage: true, label: 'Greenhouse' };
  }
  if (/jobs\.lever\.co/i.test(lower) || /lever\.co\//i.test(lower) || source === 'lever') {
    return { ats: 'lever', isCareerPage: true, label: 'Lever' };
  }
  if (/ashbyhq\.com/i.test(lower) || /jobs\.ashbyhq\.com/i.test(lower)) {
    return { ats: 'ashby', isCareerPage: true, label: 'Ashby' };
  }
  if (/myworkdayjobs\.com/i.test(lower) || /workday\.com\//i.test(lower)) {
    return { ats: 'workday', isCareerPage: true, label: 'Workday' };
  }

  // Aggregators / unknown company careers — still treat as career-page apply.
  return {
    ats: 'unknown',
    isCareerPage: CAREER_ATS.has('unknown'),
    label: sourceLabel(source) || 'Career page',
  };
}

function sourceLabel(source?: string): string | null {
  if (!source) return null;
  const map: Record<string, string> = {
    jobright: 'Jobright',
    career_portal: 'Career page',
    github: 'Career page',
    simplify: 'Career page',
    scoutify: 'Career page',
    company_portal: 'Company portal',
    other: 'Career page',
  };
  return map[source] || null;
}

/** Prefer career-page apply for any non-LinkedIn URL. */
export function prefersCareerApply(url: string, source?: string): boolean {
  const d = detectAts(url, source);
  return d.isCareerPage || d.ats !== 'linkedin';
}

export function isLinkedInEasyApplyUrl(url: string): boolean {
  return detectAts(url).ats === 'linkedin';
}
