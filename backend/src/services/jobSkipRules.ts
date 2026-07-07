import { config } from '../config';

const EXPERIENCE_PATTERN = /[(]?\s*(\d+)\s*[)]?\s*[-to]*\s*\d*[+]*\s*years?/gi;

export interface JobSkipResult {
  skip: boolean;
  reason?: string;
}

export function extractYearsOfExperience(text: string): number {
  const matches = [...text.matchAll(EXPERIENCE_PATTERN)];
  if (!matches.length) return 0;
  const years = matches
    .map((m) => parseInt(m[1], 10))
    .filter((n) => !Number.isNaN(n) && n <= 12);
  return years.length ? Math.max(...years) : 0;
}

function containsAny(text: string, words: string[]): string | null {
  const lower = text.toLowerCase();
  for (const word of words) {
    if (word && lower.includes(word.toLowerCase())) return word;
  }
  return null;
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
    const required = extractYearsOfExperience(description);
    if (required > rules.currentExperience + experienceBuffer) {
      return {
        skip: true,
        reason: `Requires ${required}+ years (cap: ${rules.currentExperience + experienceBuffer})`,
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
