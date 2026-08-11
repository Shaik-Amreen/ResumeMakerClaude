import { isNewGradOrEntryTitle } from '../data/candidateTargeting';
import {
  maxExperienceAllowed,
  parseExperienceRequirement,
  shouldSkipForExperience,
} from './jobSkipRules';

export type JobType = 'internship' | 'fulltime';
export { isInternGraduationEligible } from './internGraduation';

const FULLTIME_GRAD_PATTERNS = [
  /\b(?:jan(?:uary)?|winter)\s*2027\b/i,
  /\bsummer\s*2027\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of)\s*(?:in\s+)?(?:summer\s*|january\s*|winter\s*)?2027\b/i,
  /\b(?:expected|anticipated)\s+graduation\s*:?\s*(?:january\s*|winter\s*|summer\s*)?2027\b/i,
  /\b(?:may|june|july|august|january|december)\s*2027\s+graduat/i,
  /\bclass\s+of\s*2027\b/i,
];

const INTERN_TITLE_HINTS = /\b(intern(ship)?|co-?op)\b/i;
const FULLTIME_TITLE_HINTS =
  /\b(new\s*grad|entry[\s-]?level|full[\s-]?time|associate|software\s+engineer(?!\s+intern)|\d\s*[-–to+]+\s*\d*\s*years?)\b/i;

const FULLTIME_EXPERIENCE_HINTS = [
  /\b0\s*[-–to]+\s*[35](?:\.\d+)?\s*years?\b/i,
  /\b1\s*[-–to]+\s*[35](?:\.\d+)?\s*years?\b/i,
  /\b2\s*[-–to]+\s*[35](?:\.\d+)?\s*years?\b/i,
  /\b3\s*[-–to]+\s*5(?:\.\d+)?\s*years?\b/i,
  /\b0\s*[-–to]+\s*5(?:\.\d+)?\s*years?\b/i,
  /\bup\s+to\s+[35](?:\.\d+)?\s*years?\b/i,
  /\b(?:minimum|min\.?|at\s+least)\s+3(?:\.\d+)?\s*\+?\s*years?\b/i,
  /\b3\s*\+\s*years?\b/i,
  /\b3\.\d+\s*years?\b/i,
  /\b[123]\s*\+?\s*years?\s+(?:of\s+)?(?:experience|exp)\b/i,
  /\b[123](?:\.\d+)?\s*years?\s+experience\b/i,
];

const SENIOR_TITLE_BLOCK = /\b(senior|staff|principal|sr\.|lead|architect|director|manager|head\s+of)\b/i;

const SOFTWARE_HINTS =
  /\b(software|developer|swe\b|programming|full[\s-]?stack|backend|frontend|front[\s-]?end|web\s+dev|mobile\s+dev|react\s*native|data\s+engineer|cloud\s+engineer|platform\s+engineer|computer\s*science|\bcs\b|react|node\.?js|typescript|javascript|python\s+dev|machine\s+learning\s+engineer|ml\s+engineer)\b/i;

/** Hardware / non-SWE roles — never scrape or keep these. */
const NON_SOFTWARE_EXCLUSIONS = [
  /\bradar\b/i,
  /\belectro-?optics\b/i,
  /\bfpga\b/i,
  /\bradar\s+signal\s+processing\b/i,
  /\bdigital\s+engineering\b/i,
  /\bunderstanding\s+of\s+radar\b/i,
  /\bcpu,\s*gpu.*fpga/i,
  /\bembedded\s+hardware\b/i,
  /\bfirmware\s+engineer\b/i,
  /\bhardware\s+engineer\b/i,
  /\bRF\s+engineer\b/i,
  /\bsignal\s+processing\s+engineer\b/i,
  /\boptics\s+engineer\b/i,
];

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function isNonSoftwareRole(title: string, description: string): boolean {
  const text = `${title}\n${description}`;
  return matchesAny(text, NON_SOFTWARE_EXCLUSIONS);
}

export function isSoftwareRole(title: string, description: string): boolean {
  const text = `${title}\n${description}`;
  if (isNonSoftwareRole(title, description)) return false;
  return SOFTWARE_HINTS.test(text);
}

/** Title-only: JD text often mentions prior internships on full-time postings. */
export function isInternshipTitle(title: string): boolean {
  return INTERN_TITLE_HINTS.test(title);
}

export function inferJobType(title: string, _description?: string): JobType {
  if (isInternshipTitle(title)) return 'internship';
  return 'fulltime';
}

export function isEligibleJob(jobType: JobType, title: string, description: string): boolean {
  const text = `${title}\n${description}`;

  if (!isSoftwareRole(title, description)) {
    return false;
  }

  // Karthik targets full-time / new-grad only — never internships or co-ops.
  if (jobType === 'internship' || isInternshipTitle(title)) {
    return false;
  }

  const isFtRole =
    FULLTIME_TITLE_HINTS.test(title) ||
    /\b(software|developer|engineer)\b/i.test(title);
  if (!isFtRole) return false;

  // Always skip senior/staff/principal — even if title also says New Grad
  if (SENIOR_TITLE_BLOCK.test(title)) {
    return false;
  }

  if (/\bpart[\s-]?time\b/i.test(title) || /\bseasonal\b/i.test(title)) {
    return false;
  }

  const yoeSkip = shouldSkipForExperience(title, description);
  if (yoeSkip?.skip) return false;

  const { min: requiredMin, max: requiredMax, hasRange } = parseExperienceRequirement(text);
  const expCap = maxExperienceAllowed(); // default 3
  const inKeepableRange = hasRange && requiredMax <= 5 && requiredMin <= 3;

  // New grad / Summer 2027 graduation
  if (
    /\bnew\s*grad\b/i.test(text) ||
    /\bentry[\s-]?level\b/i.test(text) ||
    /\b2027\b/i.test(text) ||
    /\b(?:may|june|july)\s*2027\b/i.test(text) ||
    matchesAny(text, FULLTIME_GRAD_PATTERNS)
  ) {
    return true;
  }

  // 0–5 / 3–5 / 3+ yrs, etc.
  if (inKeepableRange || matchesAny(text, FULLTIME_EXPERIENCE_HINTS)) {
    return (
      inKeepableRange ||
      requiredMin === 0 ||
      requiredMin <= expCap ||
      (requiredMin <= 4 && isNewGradOrEntryTitle(title, description))
    );
  }

  if (
    requiredMin > 0 &&
    (requiredMin <= expCap || (requiredMin <= 4 && isNewGradOrEntryTitle(title, description)))
  ) {
    return true;
  }

  // No years stated — junior SWE titles only (not senior+)
  if (requiredMin === 0 && /\b(software|developer|engineer)\b/i.test(title)) {
    return true;
  }

  return false;
}

export function eligibilityReason(_jobType?: JobType): string {
  return 'Full-time software — new grad / entry-level / ≤3 years (keep 0–5 & 3–5 ranges; 4y only if new-grad/entry; MS grad January 2027)';
}
