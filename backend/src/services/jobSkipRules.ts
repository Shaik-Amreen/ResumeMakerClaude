import { config } from '../config';
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
}

function pushYear(values: number[], raw: string) {
  const v = parseFloat(raw);
  if (!Number.isNaN(v) && v >= 0 && v <= 12) values.push(v);
}

/** Parse min/max years from JD text — supports 3+, 3.2, 3-5, etc. */
export function parseExperienceRequirement(text: string): ExperienceRequirement {
  const mins: number[] = [];
  const maxs: number[] = [];

  for (const m of text.matchAll(PLUS_YEARS)) {
    pushYear(mins, m[1]);
    pushYear(maxs, m[1]);
  }

  for (const m of text.matchAll(RANGE_YEARS)) {
    pushYear(mins, m[1]);
    pushYear(maxs, m[2]);
  }

  for (const m of text.matchAll(MIN_YEARS)) {
    pushYear(mins, m[1]);
    pushYear(maxs, m[1]);
  }

  for (const m of text.matchAll(EXP_YEARS)) {
    pushYear(mins, m[1]);
    pushYear(maxs, m[1]);
  }

  for (const m of text.matchAll(DECIMAL_YEARS)) {
    pushYear(mins, m[1]);
    pushYear(maxs, m[1]);
  }

  return {
    min: mins.length ? Math.max(...mins) : 0,
    max: maxs.length ? Math.max(...maxs) : 0,
  };
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
 * "No sponsorship" postings are kept — CPT/OPT internships often still work.
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

/** Skip rules ported from Auto_job_applier_linkedIn config/search.py */
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

  let experienceBuffer = 0;
  if (rules.didMasters && lower.includes('master')) {
    experienceBuffer = 2;
  }

  if (rules.currentExperience >= 0) {
    const { min } = parseExperienceRequirement(description);
    const cap = maxExperienceAllowed() + experienceBuffer;
    if (min > cap) {
      return {
        skip: true,
        reason: `Requires ${min}+ years (cap: ${cap})`,
      };
    }
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
