import { maxExperienceAllowed, parseExperienceRequirement } from './jobSkipRules';
import { isInternGraduationEligible } from './internGraduation';

export type JobType = 'internship' | 'fulltime';
export { isInternGraduationEligible } from './internGraduation';

const FULLTIME_GRAD_PATTERNS = [
  /\bsummer\s*2027\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of)\s*(?:in\s+)?(?:summer\s*)?2027\b/i,
  /\b(?:expected|anticipated)\s+graduation\s*:?\s*(?:summer\s*)?2027\b/i,
  /\b(?:may|june|july|august)\s*2027\s+graduat/i,
];

const INTERN_TITLE_HINTS = /\b(intern(ship)?|co-?op|summer)\b/i;
const FULLTIME_TITLE_HINTS =
  /\b(new\s*grad|entry[\s-]?level|full[\s-]?time|associate|software\s+engineer(?!\s+intern)|\d\s*[-–to+]+\s*\d*\s*years?)\b/i;

const FULLTIME_EXPERIENCE_HINTS = [
  /\b0\s*[-–to]+\s*3(?:\.\d+)?\s*years?\b/i,
  /\b1\s*[-–to]+\s*3(?:\.\d+)?\s*years?\b/i,
  /\b2\s*[-–to]+\s*3(?:\.\d+)?\s*years?\b/i,
  /\bup\s+to\s+3(?:\.\d+)?\s*years?\b/i,
  /\b(?:minimum|min\.?|at\s+least)\s+3(?:\.\d+)?\s*\+?\s*years?\b/i,
  /\b3\s*\+\s*years?\b/i,
  /\b3\.\d+\s*years?\b/i,
  /\b[123]\s*\+?\s*years?\s+(?:of\s+)?(?:experience|exp)\b/i,
  /\b[123](?:\.\d+)?\s*years?\s+experience\b/i,
];

const SENIOR_TITLE_BLOCK = /\b(senior|staff|principal|sr\.|lead|architect|director|manager|head\s+of)\b/i;

const SOFTWARE_HINTS =
  /\b(software|developer|swe\b|programming|full[\s-]?stack|backend|frontend|front[\s-]?end|web\s+dev|mobile\s+dev|devops|machine\s+learning|\bml\b|data\s+engineer|cloud\s+engineer|computer\s*science|\bcs\b|react|node\.?js|typescript|javascript|python\s+dev)\b/i;

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

const SUMMER_2027_HINTS =
  /\b(summer\s*2027|2027\s+summer|intern.*2027|2027.*intern)\b/i;

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

export function inferJobType(title: string, description: string): JobType {
  const combined = `${title} ${description}`;
  if (INTERN_TITLE_HINTS.test(title) || /\bintern\b/i.test(combined)) {
    return 'internship';
  }
  if (FULLTIME_TITLE_HINTS.test(title)) {
    return 'fulltime';
  }
  if (parseExperienceRequirement(`${title} ${description}`).min > 0 && !/\bintern\b/i.test(combined)) {
    return 'fulltime';
  }
  if (/\b2027\b/i.test(title) && !/\bintern\b/i.test(title)) {
    return 'fulltime';
  }
  return 'internship';
}

export function isEligibleJob(jobType: JobType, title: string, description: string): boolean {
  const text = `${title}\n${description}`;

  if (!isSoftwareRole(title, description)) {
    return false;
  }

  if (jobType === 'internship') {
    const isInternRole = INTERN_TITLE_HINTS.test(title) || /\bintern(ship)?\b/i.test(text);
    if (!isInternRole) return false;

    const summer2027 = SUMMER_2027_HINTS.test(text) || /\b2027\b/i.test(text);
    if (!summer2027) return false;

    return isInternGraduationEligible(title, description);
  }

  const isFtRole =
    FULLTIME_TITLE_HINTS.test(title) ||
    /\b(software|developer|engineer)\b/i.test(title);
  if (!isFtRole) return false;

  if (INTERN_TITLE_HINTS.test(title) || /\bintern(ship)?\b/i.test(text)) return false;

  if (SENIOR_TITLE_BLOCK.test(title) && !/\b(associate|entry|new\s*grad)\b/i.test(title)) {
    return false;
  }

  const { min: requiredMin } = parseExperienceRequirement(text);
  const expCap = maxExperienceAllowed();

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

  // 3+, 3.2, 0–3 yrs, etc.
  if (matchesAny(text, FULLTIME_EXPERIENCE_HINTS)) {
    return requiredMin === 0 || requiredMin <= expCap;
  }

  if (requiredMin > 0 && requiredMin <= expCap) {
    return true;
  }

  // No years stated — junior SWE titles only (not senior+)
  if (requiredMin === 0 && /\b(software|developer)\b/i.test(title)) {
    return !SENIOR_TITLE_BLOCK.test(title);
  }

  return false;
}

export function eligibilityReason(jobType: JobType): string {
  return jobType === 'internship'
    ? 'Summer 2027 software internship — MS grad Dec 2027 / Jan 2028'
    : 'Full-time software — new grad, 3+, or up to ~3.5 years';
}
