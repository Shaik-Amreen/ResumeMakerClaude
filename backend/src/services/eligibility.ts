export type JobType = 'internship' | 'fulltime';

const INTERN_GRAD_PATTERNS = [
  /\bjan(?:uary)?\s*2028\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of)\s*(?:in\s+)?(?:jan(?:uary)?\s*)?2028\b/i,
  /\b(?:expected|anticipated)\s+graduation\s*:?\s*(?:jan(?:uary)?\s*)?2028\b/i,
  /\b(?:spring|summer|fall|winter)\s*2028\s+graduat/i,
];

const FULLTIME_GRAD_PATTERNS = [
  /\bsummer\s*2027\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of)\s*(?:in\s+)?(?:summer\s*)?2027\b/i,
  /\b(?:expected|anticipated)\s+graduation\s*:?\s*(?:summer\s*)?2027\b/i,
  /\b(?:may|june|july|august)\s*2027\s+graduat/i,
];

const INTERN_TITLE_HINTS = /\b(intern(ship)?|co-?op|summer)\b/i;
const FULLTIME_TITLE_HINTS = /\b(new\s*grad|entry[\s-]?level|full[\s-]?time|associate|software\s+engineer(?!\s+intern))\b/i;

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
    const gradOk = /\b2028\b/i.test(text) || matchesAny(text, INTERN_GRAD_PATTERNS);

    return summer2027 && (gradOk || /\b2027\b/i.test(text));
  }

  const isFtRole =
    FULLTIME_TITLE_HINTS.test(title) ||
    /\b(software|developer)\b/i.test(title);
  if (!isFtRole) return false;

  return (
    /\b2027\b/i.test(text) ||
    /\b(?:may|june|july)\s*2027\b/i.test(text) ||
    matchesAny(text, FULLTIME_GRAD_PATTERNS)
  );
}

export function eligibilityReason(jobType: JobType): string {
  return jobType === 'internship'
    ? 'Summer 2027 software internship — MS grad Jan 2028'
    : 'Full-time from May 2027 — graduation Summer 2027';
}
