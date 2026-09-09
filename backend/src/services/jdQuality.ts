/**
 * JD quality scoring + hydrate-before-save.
 * Goal: never feed preview/aggregator chrome into resume generation when a full employer JD exists.
 */
import { cleanJobDescriptionForResume, looksTruncatedJd } from './cleanJobDescription';
import {
  fetchJobDescriptionFromApplyUrl,
  isInvalidOrMissingJd,
  type JdFetchSession,
} from './applyPageJdFetcher';

/** Absolute floor — still invalid chrome / stubs. */
export const MIN_JD_CHARS_VALID = 200;

/**
 * Minimum richness for auto-resume / high-quality tailoring.
 * Below this we still may *save* the job (if valid) but should not auto-generate.
 */
export const MIN_JD_CHARS_RESUME = 800;

const STRUCTURE_RE =
  /\b(responsibilit|qualification|requirement|what you.?ll|about the role|job description|minimum qualifications|preferred qualifications|basic qualifications|you will|we.?re looking for|requirements|nice to have|must have)\b/gi;

const CHROME_RE =
  /\b(apply with autofill|job recommendations|customize your resume|build cover letter|cookie settings|sign in|create account|powered by workday|crunchbase|turbo for students)\b/gi;

const AGGREGATOR_HOST =
  /(?:jobright\.ai|linkedin\.com|indeed\.com|google\.com\/search|jobs\.google\.com|scoutify\.com|simplify\.jobs)/i;

export function scoreJdQuality(raw: string): number {
  const text = cleanJobDescriptionForResume(raw || '');
  if (!text || isInvalidOrMissingJd(text)) return 0;

  const len = text.length;
  const structureHits = (text.match(STRUCTURE_RE) || []).length;
  const chromeHits = (text.match(CHROME_RE) || []).length;
  const techHits = (
    text.match(
      /\b(python|java(?:script)?|typescript|react|node\.?js|c\+\+|sql|aws|docker|kubernetes|linux|api|backend|frontend|software|spring|postgres|mongodb|redis|ci\/cd)\b/gi
    ) || []
  ).length;

  // Length dominates; structure/tech boost; chrome/UI noise penalizes.
  // Truncated mid-sentence JDs get a heavy penalty so employer hydrate wins.
  const truncPenalty = looksTruncatedJd(text) ? 2500 : 0;
  return Math.max(
    0,
    Math.min(len, 50000) + structureHits * 120 + techHits * 25 - chromeHits * 180 - truncPenalty
  );
}

/** True when JD is solid enough to tailor a 1-page resume with keyword coverage. */
export function isJdRichEnoughForResume(raw: string): boolean {
  const text = cleanJobDescriptionForResume(raw || '');
  if (!text || isInvalidOrMissingJd(text)) return false;
  if (looksTruncatedJd(text) && text.length < 2500) return false;
  if (text.length >= MIN_JD_CHARS_RESUME) return true;
  // Slightly shorter but clearly structured JDs (rare compact postings)
  const structureHits = (text.match(STRUCTURE_RE) || []).length;
  return text.length >= 550 && structureHits >= 2;
}

/** Prefer the higher-quality JD; ties keep `preferred` (usually employer). */
export function preferBetterJd(a: string, b: string, preferred: 'a' | 'b' = 'b'): string {
  const ca = cleanJobDescriptionForResume(a || '');
  const cb = cleanJobDescriptionForResume(b || '');
  const sa = scoreJdQuality(ca);
  const sb = scoreJdQuality(cb);
  if (sa === 0 && sb === 0) return '';
  if (sb > sa) return cb;
  if (sa > sb) return ca;
  // Same score: prefer non-truncated / longer
  if (looksTruncatedJd(ca) && !looksTruncatedJd(cb)) return cb;
  if (looksTruncatedJd(cb) && !looksTruncatedJd(ca)) return ca;
  if (cb.length > ca.length + 200) return cb;
  if (ca.length > cb.length + 200) return ca;
  return preferred === 'b' ? cb || ca : ca || cb;
}

export function isLikelyEmployerApplyUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (AGGREGATOR_HOST.test(url) || AGGREGATOR_HOST.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export type HydrateJdResult = {
  text: string;
  source: 'board' | 'employer' | 'none';
  boardScore: number;
  employerScore: number;
};

/**
 * Pick the best available JD: board/panel text vs hydrated employer/ATS page.
 * Always tries the apply URL when it looks like a real career/ATS link.
 */
export async function hydrateBestJobDescription(opts: {
  boardText?: string;
  applyUrl?: string;
  allowSelenium?: boolean;
  session?: JdFetchSession;
}): Promise<HydrateJdResult> {
  const board = cleanJobDescriptionForResume(opts.boardText || '');
  const boardScore = scoreJdQuality(board);

  let employer = '';
  let employerScore = 0;
  const url = (opts.applyUrl || '').trim();

  // Always try employer hydrate when board looks truncated, even if URL is borderline.
  const mustHydrate = looksTruncatedJd(board) || board.length < MIN_JD_CHARS_RESUME;

  if (
    isLikelyEmployerApplyUrl(url) ||
    (mustHydrate && /^https?:\/\//i.test(url) && !AGGREGATOR_HOST.test(url))
  ) {
    try {
      employer = await fetchJobDescriptionFromApplyUrl(url, {
        allowSelenium: opts.allowSelenium !== false || mustHydrate,
        session: opts.session,
      });
      employer = cleanJobDescriptionForResume(employer);
      employerScore = scoreJdQuality(employer);
    } catch (err) {
      console.warn(
        `JD hydrate failed for ${url.slice(0, 100)}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Prefer employer when board is truncated and employer is longer / complete.
  if (
    employer &&
    looksTruncatedJd(board) &&
    !looksTruncatedJd(employer) &&
    employer.length >= Math.min(board.length, 400)
  ) {
    console.log(
      `  ↳ JD hydrated from employer (board looked truncated; ${employer.length} chars vs board ${board.length})`
    );
    return { text: employer, source: 'employer', boardScore, employerScore };
  }

  if (employerScore > boardScore && employer) {
    console.log(
      `  ↳ JD hydrated from employer (${employer.length} chars, score ${employerScore} > board ${boardScore})`
    );
    return { text: employer, source: 'employer', boardScore, employerScore };
  }

  if (boardScore > 0 && board) {
    if (url && isLikelyEmployerApplyUrl(url) && employerScore === 0) {
      console.log(
        `  ↳ Employer JD hydrate missed — keeping board text (${board.length} chars, score ${boardScore})`
      );
    }
    return { text: board, source: 'board', boardScore, employerScore };
  }

  if (employerScore > 0 && employer) {
    return { text: employer, source: 'employer', boardScore, employerScore };
  }

  return { text: '', source: 'none', boardScore: 0, employerScore: 0 };
}
