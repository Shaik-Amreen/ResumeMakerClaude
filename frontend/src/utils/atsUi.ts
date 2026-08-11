/** Shared ATS / apply UI helpers for badges and copy. */

export type AtsUiKind =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'linkedin'
  | 'indeed'
  | 'career';

export function detectAtsUi(url: string, source?: string, atsType?: string): {
  kind: AtsUiKind;
  label: string;
} {
  if (atsType && atsType !== 'unknown') {
    const map: Record<string, { kind: AtsUiKind; label: string }> = {
      greenhouse: { kind: 'greenhouse', label: 'Greenhouse' },
      lever: { kind: 'lever', label: 'Lever' },
      ashby: { kind: 'ashby', label: 'Ashby' },
      workday: { kind: 'workday', label: 'Workday' },
      linkedin: { kind: 'linkedin', label: 'LinkedIn' },
      indeed: { kind: 'indeed', label: 'Indeed' },
    };
    if (map[atsType]) return map[atsType];
  }

  const u = (url || '').toLowerCase();
  if (/linkedin\.com\/(jobs|job)/.test(u)) return { kind: 'linkedin', label: 'LinkedIn' };
  if (/indeed\.com/.test(u) || source === 'indeed') return { kind: 'indeed', label: 'Indeed' };
  if (/greenhouse\.io/.test(u) || source === 'greenhouse')
    return { kind: 'greenhouse', label: 'Greenhouse' };
  if (/jobs\.lever\.co|lever\.co\//.test(u) || source === 'lever')
    return { kind: 'lever', label: 'Lever' };
  if (/ashbyhq\.com/.test(u)) return { kind: 'ashby', label: 'Ashby' };
  if (/myworkdayjobs\.com|workday\.com\//.test(u)) return { kind: 'workday', label: 'Workday' };
  return { kind: 'career', label: 'Career page' };
}

export const ATS_BADGE_CLASS: Record<AtsUiKind, string> = {
  greenhouse: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  lever: 'bg-sky-50 text-sky-900 border-sky-200',
  ashby: 'bg-violet-50 text-violet-900 border-violet-200',
  workday: 'bg-orange-50 text-orange-900 border-orange-200',
  linkedin: 'bg-blue-50 text-blue-900 border-blue-200',
  indeed: 'bg-indigo-50 text-indigo-900 border-indigo-200',
  career: 'bg-cedar-soft text-cedar-ink border-cedar/25',
};

export function isCareerApplyUrl(url: string): boolean {
  return !/linkedin\.com\/(jobs|job)/i.test(url || '');
}
