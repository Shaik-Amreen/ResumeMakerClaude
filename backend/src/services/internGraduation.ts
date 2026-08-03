/** Candidate graduation window: January 2027 (full-time primary; legacy internship mode). */
const INTERN_COMPATIBLE_GRAD_PATTERNS = [
  /\bjan(?:uary)?\.?\s*2027\b/i,
  /\bwinter\s*2027\b/i,
  /\bdec(?:ember)?\.?\s*2026\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,40}\b(?:fall|winter)\s*2026\b/i,
  /\b(?:fall|winter)\s*2026.{0,20}graduat/i,
  /\b(?:dec(?:ember)?\.?|fall|winter)\s*2026\s*[-–to]+\s*(?:jan(?:uary)?\.?|may|june|spring|summer|winter)\s*2027\b/i,
  /\b2026\s*[-–\/]\s*2027\b/i,
  /\bclass\s+of\s*2026\s*(?:or|,|\/|&|and)\s*2027\b/i,
  /\bclass\s+of\s*2027\b/i,
  /\bgraduat(?:e|ing|ion).{0,40}(?:dec(?:ember)?\.?\s*)?2026.{0,40}2027\b/i,
  /\bgraduat(?:e|ing|ion).{0,40}2026.{0,20}(?:or|through|to|[-–]).{0,20}2027\b/i,
  /\b(?:dec(?:ember)?\.?\s*2026|jan(?:uary)?\.?\s*2027)\s+or\s+later\b/i,
];

/** Explicit graduation requirements that exclude January 2027. */
const INTERN_INCOMPATIBLE_GRAD_PATTERNS = [
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,30}\b(?:may|june|july|august|spring|summer)\s*202[56]\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,30}\b(?:dec(?:ember)?|fall|winter)\s*2025\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,30}\b(?:may|june|july|spring|summer)\s*2027\b/i,
  /\bclass\s+of\s*202[456]\b/i,
  /\bclass\s+of\s*202[89]\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,30}\b(?:may|june|july|august|fall|spring|summer|winter)\s*2028\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,30}\b(?:jan(?:uary)?|may|june)\s*2029\b/i,
  /\b(?:graduat(?:e|ing|ion)|class\s+of).{0,30}\b(?:dec(?:ember)?|jan(?:uary)?)\s*2028\b/i,
  /\bmust\s+graduat(?:e|ing).{0,40}\b(?:before|by)\s+(?:may|june|july|august|summer)\s*2026\b/i,
  /\bexpected\s+graduation\s*:?\s*(?:may|june|july|spring|summer)\s*2027\b/i,
  /\bexpected\s+graduation\s*:?\s*(?:may|june|dec(?:ember)?)\s*2025\b/i,
  /\bgraduating\s+(?:only\s+)?(?:in\s+)?(?:may|june|spring|summer)\s*2027\b/i,
  /\bgraduating\s+(?:in\s+)?2025\b/i,
  /\bgraduating\s+(?:in\s+)?(?:fall|dec(?:ember)?)\s*2027\b/i,
  /\bgraduating\s+(?:in\s+)?(?:fall|dec(?:ember)?|jan(?:uary)?)\s*2028\b/i,
];

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

/** True when JD talks about a required / expected graduation date or class year. */
function hasExplicitGraduationRequirement(text: string): boolean {
  return (
    /\b(?:expected|anticipated)\s+graduation\b/i.test(text) ||
    /\bgraduation\s+date\b/i.test(text) ||
    /\bclass\s+of\s*20\d{2}\b/i.test(text) ||
    /\bgraduating\s+(?:in|by|before|after|between|on|dec|jan|may|june|july|aug|fall|spring|winter|summer|20\d{2})\b/i.test(
      text
    ) ||
    /\bmust\s+(?:be\s+)?graduat/i.test(text) ||
    /\bgraduat(?:e|ion)\s+(?:by|before|after|between|in)\b/i.test(text)
  );
}

/**
 * Graduation eligibility for MS candidate (January 2027).
 * Keep when JD says nothing about graduation, or when the stated window includes
 * Jan 2027. Skip only clear mismatches.
 */
export function isInternGraduationEligible(title: string, description: string): boolean {
  const text = `${title}\n${description}`;

  if (matchesAny(text, INTERN_COMPATIBLE_GRAD_PATTERNS)) return true;

  if (!hasExplicitGraduationRequirement(text)) return true;

  if (matchesAny(text, INTERN_INCOMPATIBLE_GRAD_PATTERNS)) return false;

  // Vague graduation language ("currently enrolled", "pursuing a degree") — keep.
  return true;
}
