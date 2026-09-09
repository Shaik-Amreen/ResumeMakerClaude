import { config } from '../config';
import {
  isCryptoOnlyRole,
  isMlEngineerWithoutSoftwareFocus,
  isNewGradOrEntryTitle,
  isSolutionsRoleWithoutCoding,
  isUnpaidOrContractOnly,
  mentionsNoSponsorship,
  requiresImmediateStartBeforeGrad,
  shouldSkipTargetTitle,
} from '../data/candidateTargeting';
import { isInternGraduationEligible } from './internGraduation';

const PLUS_YEARS = /\b(\d+(?:\.\d+)?)\s*\+\s*years?\b/gi;
const RANGE_YEARS = /\b(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)\s*years?\b/gi;
const MIN_YEARS = /\b(?:minimum|min\.?|at\s+least)\s*(\d+(?:\.\d+)?)\s*years?\b/gi;
const EXP_YEARS = /\b(\d+(?:\.\d+)?)\s*years?\s+(?:of\s+)?(?:experience|exp)\b/gi;
const DECIMAL_YEARS = /\b(\d+\.\d+)\s*years?\b/gi;

export interface JobSkipResult {
  skip: boolean;
  reason?: string;
}

/**
 * Non-US country explicitly called out in the job title.
 * e.g. "Software Engineer (New Graduates: Canada)" or "SWE – UK Only"
 */
const NON_US_TITLE_COUNTRY =
  /\b(?:canada|uk|united\s+kingdom|great\s+britain|australia|new\s+zealand|india|germany|france|netherlands|ireland|singapore|mexico|brazil|europe|emea|latam)\b/i;

export interface ExperienceRequirement {
  /** Lowest stated requirement (e.g. 3 from "3+ years" or "3-5 years"). */
  min: number;
  /** Highest stated requirement (e.g. 5 from "3-5 years"). */
  max: number;
  /** True when a numeric range like 0-5 / 3-5 was parsed. */
  hasRange: boolean;
}

function pushYear(values: number[], raw: string) {
  const v = parseFloat(raw);
  if (!Number.isNaN(v) && v >= 0 && v <= 12) values.push(v);
}

/** Parse min/max years from JD text — supports 3+, 3.2, 3-5, etc. */
export function parseExperienceRequirement(text: string): ExperienceRequirement {
  const rangeLows: number[] = [];
  const rangeHighs: number[] = [];
  const floors: number[] = [];

  for (const m of text.matchAll(RANGE_YEARS)) {
    pushYear(rangeLows, m[1]);
    pushYear(rangeHighs, m[2]);
  }

  for (const m of text.matchAll(PLUS_YEARS)) {
    pushYear(floors, m[1]);
  }

  for (const m of text.matchAll(MIN_YEARS)) {
    pushYear(floors, m[1]);
  }

  for (const m of text.matchAll(EXP_YEARS)) {
    // Avoid treating the high end of "0-5 years of experience" as a 5-year floor
    const idx = m.index ?? 0;
    if (idx > 0 && /[-–]/.test(text[idx - 1] || '')) continue;
    pushYear(floors, m[1]);
  }

  for (const m of text.matchAll(DECIMAL_YEARS)) {
    const idx = m.index ?? 0;
    if (idx > 0 && /[-–]/.test(text[idx - 1] || '')) continue;
    pushYear(floors, m[1]);
  }

  const hasRange = rangeLows.length > 0;
  const rangeMin = hasRange ? Math.min(...rangeLows) : 0;
  const rangeMax = hasRange ? Math.max(...rangeHighs) : 0;
  const floorMin = floors.length ? Math.max(...floors) : 0;

  if (hasRange) {
    // Range band is primary (keeps 0–5 / 3–5). Escalate only if a stricter floor exceeds the band.
    if (floorMin > rangeMax) {
      return { min: floorMin, max: floorMin, hasRange: true };
    }
    return { min: rangeMin, max: rangeMax, hasRange: true };
  }

  return { min: floorMin, max: floorMin, hasRange: false };
}

/** Keep 0–5 / 3–5 style bands; skip hard 5+ floors; allow 4 only for new-grad/entry. */
export function shouldSkipForExperience(
  title: string,
  description: string
): JobSkipResult | null {
  const rules = config.skipRules;
  if (rules.currentExperience < 0) return null;

  const { min, max, hasRange } = parseExperienceRequirement(description);
  const hardCap = maxExperienceAllowed();

  // Explicit keep: ranges like 0-5 or 3-5 years
  if (hasRange && max <= 5 && min <= 3) {
    return null;
  }

  if (min >= 5) {
    return { skip: true, reason: `Requires ${min}+ years (skip 5+)` };
  }

  if (min > hardCap) {
    if (min <= 4 && isNewGradOrEntryTitle(title, description)) return null;
    return {
      skip: true,
      reason: `Requires ${min}+ years (cap: ${hardCap}${
        min <= 4 ? '; 4y only for new-grad/entry titles' : ''
      })`,
    };
  }

  return null;
}

/** @deprecated Prefer parseExperienceRequirement — returns minimum stated years. */
export function extractYearsOfExperience(text: string): number {
  return parseExperienceRequirement(text).min;
}

export function maxExperienceAllowed(): number {
  const rules = config.skipRules;
  if (rules.currentExperience < 0) return Infinity;
  return rules.currentExperience + rules.experienceTolerance;
}

function containsAny(text: string, words: string[]): string | null {
  const lower = text.toLowerCase();
  for (const word of words) {
    if (word && lower.includes(word.toLowerCase())) return word;
  }
  return null;
}

/** JD/title also welcomes master's / graduate students — keep these. */
const GRAD_STUDENT_WELCOME =
  /\b(graduate\s+students?|grad\s+students?|master'?s|masters\b|m\.?s\.?\b|m\.?sc\.?\b|ph\.?d|mba\b|graduate[\s-]level|graduate\s+program|or\s+graduate|undergraduate\s+or\s+graduate|bachelor'?s?\s+or\s+master'?s?)\b/i;

/**
 * Roles restricted to undergraduates only (MS candidates should skip).
 * Inclusive "undergrad or grad" / bachelor's-or-master's postings are kept.
 */
const UNDERGRAD_ONLY_PATTERNS: RegExp[] = [
  /\bundergraduates?\s+only\b/i,
  /\bonly\s+(?:open\s+to\s+|for\s+)?undergraduates?\b/i,
  /\bopen\s+(?:exclusively\s+|only\s+)?to\s+undergraduates?\b/i,
  /\brestricted\s+to\s+undergraduates?\b/i,
  /\bmust\s+be\s+(?:an?\s+)?undergraduate\b/i,
  /\bcurrently\s+enrolled\s+(?:as\s+)?(?:an?\s+)?undergraduate\b/i,
  /\benrolled\s+in\s+(?:a\s+)?bachelor'?s\b/i,
  /\bpursuing\s+(?:a\s+)?bachelor'?s(?:\s+degree)?\b/i,
  /\bbachelor'?s\s+(?:degree\s+)?students?\s+only\b/i,
  /\b(?:bs|ba|b\.s\.|b\.a\.)\s+students?\s+only\b/i,
  /\bonly\s+(?:bs|ba|b\.s\.|b\.a\.|bachelor'?s)\s+students?\b/i,
  /\brising\s+(?:freshman|freshmen|sophomore|junior|senior)s?\b/i,
  /\bundergraduate\s+(?:research\s+)?(?:internship|intern|program)\b/i,
  /\bundergrad(?:uate)?\s+intern(?:ship)?s?\b/i,
  /\bsoftware\s+undergrad(?:uate)?\b/i,
  /\bfor\s+undergraduate\s+students?\s+only\b/i,
  /\beligible\s+(?:applicants|candidates)\s+(?:are|must\s+be)\s+undergraduates?\b/i,
];

/** PhD-only postings (MS candidates should skip unless masters also listed). */
const PHD_ONLY_TITLE = /\bph\.?d\b/i;
const MASTERS_OR_GRAD_WELCOME =
  /\b(master'?s|masters\b|m\.?s\.?\b|graduate\s+student|grad\s+student|bachelor'?s?\s+or\s+master'?s?|undergrad(?:uate)?\s+or\s+(?:grad|master))/i;

/**
 * Hard blockers for Masters F-1 students (citizenship / permanent resident only).
 * "No sponsorship" is handled separately via mentionsNoSponsorship (skip).
 * Intentionally avoids bare "US Citizen" substring so "citizenship not required" still passes.
 */
const F1_INELIGIBLE_PATTERNS: RegExp[] = [
  /\b(?:must\s+be|only|require[sd]?)\s+(?:an?\s+)?u\.?s\.?\s+citizens?\b/i,
  /\bu\.?s\.?\s+citizenship\s+(?:is\s+)?required\b/i,
  /\bcitizens?(?:hip)?\s+(?:is\s+)?required\b/i,
  /\bcitizens?\s+only\b/i,
  /\bonly\s+(?:u\.?s\.?\s+)?citizens?\b/i,
  /\b(?:open|available)\s+(?:exclusively\s+)?to\s+(?:u\.?s\.?\s+)?citizens?\b/i,
  /\bmust\s+be\s+(?:a\s+)?(?:permanent\s+resident|green\s+card\s+holder)\b/i,
  /\b(?:permanent\s+residents?|green\s+card\s+holders?)\s+only\b/i,
  /\bgreen\s+card\s+(?:is\s+)?required\b/i,
  /\bpermanent\s+residency\s+(?:is\s+)?required\b/i,
];

/** True when posting requires citizenship / PR that blocks F-1 students. */
export function isIneligibleForMastersF1(title: string, description: string): boolean {
  const text = `${title}\n${description}`;
  return F1_INELIGIBLE_PATTERNS.some((re) => re.test(text));
}

/** True when the posting is aimed only at undergrads (not MS/grad). */
export function isUndergraduateOnlyJob(title: string, description: string): boolean {
  const text = `${title}\n${description}`;
  // Title explicitly undergrad and does not mention masters/grad
  if (/\bundergrad(?:uate)?\b/i.test(title) && !MASTERS_OR_GRAD_WELCOME.test(text)) {
    return true;
  }
  if (!UNDERGRAD_ONLY_PATTERNS.some((re) => re.test(text))) return false;
  // e.g. "undergraduates or graduate students" / "Bachelor's or Master's"
  if (GRAD_STUDENT_WELCOME.test(text)) return false;
  return true;
}

export function isPhdOnlyJob(title: string, description: string): boolean {
  const text = `${title}\n${description}`;
  if (!PHD_ONLY_TITLE.test(title)) return false;
  if (MASTERS_OR_GRAD_WELCOME.test(text) || /\bmaster'?s\b/i.test(title)) return false;
  // Title is PhD internship without masters path
  return /\bintern/i.test(title);
}

/** Skip rules for Karthik targeting brief + Auto_job_applier-style filters. */
export function shouldSkipJobDescription(
  title: string,
  company: string,
  description: string
): JobSkipResult {
  const rules = config.skipRules;
  const text = `${title}\n${description}`;
  const lower = description.toLowerCase();

  // Country explicitly called out in the title (e.g. "New graduates: Canada")
  if (NON_US_TITLE_COUNTRY.test(title)) {
    return { skip: true, reason: `Non-US country in job title: "${title}"` };
  }

  const titleSkip = shouldSkipTargetTitle(title);
  if (titleSkip.skip) return titleSkip;

  if (isUndergraduateOnlyJob(title, description)) {
    return { skip: true, reason: 'Undergraduate students only (MS candidates skipped)' };
  }

  if (isPhdOnlyJob(title, description)) {
    return { skip: true, reason: 'PhD-only internship (MS candidates skipped)' };
  }

  if (isIneligibleForMastersF1(title, description)) {
    return {
      skip: true,
      reason: 'Not eligible for Masters F-1 (U.S. citizenship / PR required)',
    };
  }

  if (mentionsNoSponsorship(text)) {
    return {
      skip: true,
      reason: 'No visa sponsorship (now or future) — F-1 OPT / future H-1B path blocked',
    };
  }

  if (isUnpaidOrContractOnly(text)) {
    return { skip: true, reason: 'Unpaid or contract-only role' };
  }

  if (/\bpart[\s-]?time\b/i.test(title) || /\bseasonal\b/i.test(title)) {
    return { skip: true, reason: 'Part-time or seasonal role' };
  }

  if (
    /\bcontract[\s-]?to[\s-]?hire\b/i.test(text) ||
    /\bc2h\b/i.test(text) ||
    /\btemp[\s-]?to[\s-]?hire\b/i.test(text)
  ) {
    return { skip: true, reason: 'Contract-to-hire / temp-to-hire (skip)' };
  }

  if (isCryptoOnlyRole(title, description)) {
    return { skip: true, reason: 'Crypto-only role' };
  }

  if (isMlEngineerWithoutSoftwareFocus(title, description)) {
    return { skip: true, reason: 'ML Engineer without software/platform focus' };
  }

  if (isSolutionsRoleWithoutCoding(title, description)) {
    return { skip: true, reason: 'Solutions/Forward Deployed without coding focus' };
  }

  if (requiresImmediateStartBeforeGrad(title, description)) {
    return {
      skip: true,
      reason: 'Requires full-time start before January 2027 graduation',
    };
  }

  // Foreign university enrollment / EU-passport-only internship paths (e.g. ING NL)
  if (
    /\b(?:enrolled\s+at\s+(?:a\s+)?(?:dutch|eu|european|netherlands)\s+university|dutch\s+university|eu[- ]university\s+for\s+eu\s+passport|mandatory\s+to\s+be\s+enrolled\s+at\s+(?:a\s+)?dutch)\b/i.test(
      text
    )
  ) {
    return {
      skip: true,
      reason: 'Requires Dutch/EU university enrollment (CSULB / U.S. F-1 ineligible)',
    };
  }

  const looksIntern =
    /\bintern(ship)?\b/i.test(title) ||
    /\bco-?op\b/i.test(title) ||
    /\bintern(ship)?\b/i.test(description);
  if (looksIntern && !isInternGraduationEligible(title, description)) {
    return {
      skip: true,
      reason: 'Graduation window incompatible with January 2027',
    };
  }

  if (rules.companyBlacklist.length) {
    const blocked = containsAny(company, rules.companyBlacklist);
    if (blocked) {
      return { skip: true, reason: `Company blacklisted: "${blocked}"` };
    }
  }

  const companyAbout = shouldSkipCompanyAbout(`${company}\n${description}`);
  if (companyAbout.skip) return companyAbout;

  const badWord = containsAny(text, rules.badWords);
  if (badWord) {
    return { skip: true, reason: `Job description contains "${badWord}"` };
  }

  if (
    !rules.securityClearance &&
    (lower.includes('polygraph') ||
      lower.includes('security clearance') ||
      /\bclearance required\b/i.test(lower) ||
      /\bsecret\b/i.test(lower))
  ) {
    return { skip: true, reason: 'Requires security clearance' };
  }

  if (rules.currentExperience >= 0) {
    const yoeSkip = shouldSkipForExperience(title, description);
    if (yoeSkip) return yoeSkip;
  }

  return { skip: false };
}

export function shouldSkipCompanyAbout(aboutText: string): JobSkipResult {
  const rules = config.skipRules;
  const lower = aboutText.toLowerCase();

  const goodWord = containsAny(lower, rules.aboutCompanyGoodWords);
  if (goodWord) return { skip: false };

  const badWord = containsAny(lower, rules.aboutCompanyBadWords);
  if (badWord) {
    return { skip: true, reason: `Company about section contains "${badWord}"` };
  }

  return { skip: false };
}
