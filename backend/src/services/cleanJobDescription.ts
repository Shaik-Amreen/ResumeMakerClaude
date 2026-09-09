/**
 * Convert employer/ATS HTML into preformatted plain text that keeps the
 * posting’s visual structure (headings, paragraphs, bullets) for <pre> display.
 * Spacing matches a typical career-page JD — compact bullets, one blank line between sections.
 */
export function htmlToPreformattedJd(html: string): string {
  let h = String(html || '');
  if (!h.trim()) return '';

  // Double-encoded Greenhouse content
  h = decodeEntities(decodeEntities(h));

  h = h
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Headings — one blank line before, none after (text follows on next line)
    .replace(/<h([1-6])[^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/section>/gi, '\n')
    .replace(/<\/article>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<\/th>/gi, '\t')
    .replace(/<hr[^>]*>/gi, '\n────────────────\n')
    .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<(strong|b)[^>]*>/gi, '')
    .replace(/<\/(strong|b)>/gi, '')
    .replace(/<(em|i)[^>]*>/gi, '')
    .replace(/<\/(em|i)>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hx) => String.fromCharCode(parseInt(hx, 16)));

  return normalizePreformattedJd(h);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Compact JD layout to match live postings:
 * - at most one blank line between paragraphs/sections
 * - no blank lines between consecutive bullet points
 */
export function normalizePreformattedJd(raw: string): string {
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());

  const isBullet = (line: string) => /^[•\-\*]\s+\S/.test(line.trim());
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      // Skip blank lines between two bullets
      let prev = '';
      for (let p = out.length - 1; p >= 0; p--) {
        if (out[p].trim()) {
          prev = out[p];
          break;
        }
      }
      let next = '';
      for (let n = i + 1; n < lines.length; n++) {
        if (lines[n].trim()) {
          next = lines[n];
          break;
        }
      }
      if (isBullet(prev) && isBullet(next)) continue;
      // Keep at most one blank line (paragraph break)
      if (out.length && !out[out.length - 1].trim()) continue;
      out.push('');
      continue;
    }
    out.push(line);
  }

  return out.join('\n').trim();
}

/** Strip Jobright / LinkedIn / HTML noise so the model sees the real JD — without cutting the posting short. */

function looksLikeAggregatorChrome(jd: string): boolean {
  return /\b(APPLY WITH AUTOFILL|Job Recommendations|Customize Your Resume|Build Cover Letter|Analyze How Well You Fit|Turbo for Students|Jobright AI|Why this job is a match|Company data provided by crunchbase)\b/i.test(
    jd
  );
}

/**
 * Only strip known *aggregator UI* tails — never employer legal/EEO text.
 * Cutting at "Equal Opportunity" was truncating Amazon/Salesforce mid-sentence.
 */
const AGGREGATOR_END_MARKERS = [
  'Company data provided by crunchbase',
  'Customize Your Resume',
  'Build Cover Letter',
  'Analyze How Well You Fit',
  'Turbo for Students',
  'Job Recommendations | Jobright AI',
  'Why this job is a match',
  'Job Recommendations',
  'Staffing Agency Submission Notice',
  'content-pay-transparency',
];

/** Prefer full section headers over bare words like "Required" (which cut real JDs). */
const AGGREGATOR_START_MARKERS = [
  'Original Job Post',
  'Job Summary',
  'About the role',
  "What you'll do",
  'Job Description',
  'Job Expectations',
  'Responsibilities',
  'Qualifications',
  'Knowledge, Skills',
];

/**
 * Clean + preserve layout for storage / <pre> display.
 * Prefer employer HTML converted via htmlToPreformattedJd over flattened one-liners.
 */
export function cleanJobDescriptionForResume(raw: string): string {
  let jd = (raw || '').trim();
  if (!jd) return jd;

  // Pasted HTML job posts (Greenhouse/Workday copy) — preserve structure for <pre>.
  if (/<\/?[a-z][\s\S]*>/i.test(jd) || /&nbsp;|&amp;|&lt;/i.test(jd)) {
    jd = htmlToPreformattedJd(jd);
  } else {
    jd = normalizePreformattedJd(jd);
  }

  const aggregator = looksLikeAggregatorChrome(jd);

  // Only chop chrome when this clearly came from Jobright / similar — not employer ATS text.
  if (aggregator) {
    for (const marker of AGGREGATOR_START_MARKERS) {
      const idx = jd.indexOf(marker);
      if (idx >= 0 && idx < 8000) {
        jd = jd.slice(idx);
        break;
      }
    }

    for (const marker of AGGREGATOR_END_MARKERS) {
      const idx = jd.search(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      if (idx > 200) {
        jd = jd.slice(0, idx).trim();
        break;
      }
    }

    // If the paste includes multiple Jobright cards, keep only the first job block
    const nextCard = jd.search(
      /\n(?:Be an early applicant|Software (?:Engineer|Development|Developer) Intern)/i
    );
    if (nextCard > 400) {
      jd = jd.slice(0, nextCard).trim();
    }
  }

  jd = jd
    .replace(/^(Jobs\n|Resume\n|Profile\n|Agent\n|Coaching\n|Interview\n)+/i, '')
    .replace(/APPLY WITH AUTOFILL\n/gi, '')
    .replace(/Overview\nCompany\nShare\nReport Issue\n/gi, '')
    .replace(/Less than \d+ applicants/gi, '')
    .replace(/\d+%\s*STRONG MATCH/gi, '')
    .replace(/\b(?:checkPHP|checkHTML|checkCSS|checkJavaScript)\b/g, '')
    .replace(/\bFeedBlockStory\b[\s\S]{0,200}/gi, ' ')
    .replace(/\bThemeableIconButtonPresentation\b[\s\S]{0,80}/gi, ' ')
    .replace(/\bTruncatedRichText\b/gi, ' ')
    .replace(/#LI-[A-Z0-9]+\b/gi, ' ');

  return normalizePreformattedJd(jd) || raw.trim();
}

/** True when text appears cut mid-sentence / mid-phrase (common Scoutify/API truncations). */
export function looksTruncatedJd(raw: string): boolean {
  const t = (raw || '').replace(/\s+/g, ' ').trim();
  if (t.length < 120) return true;
  if (/[.!?]["')\]]?\s*$/.test(t)) return false;
  // Ends on a dangling function-word / incomplete clause
  if (
    /\b(an|a|the|of|to|and|or|with|for|including|regarding|about|from|into|as|is|are|was|were|be|by|on|in|at|your|our|their|this|that|these|those|use|using)\s*$/i.test(
      t
    )
  ) {
    return true;
  }
  // Ends mid-word (no trailing punctuation, last token very short after long text)
  const last = t.split(/\s+/).pop() || '';
  if (t.length > 500 && last.length <= 2 && !/[.!?]$/.test(last)) return true;
  return false;
}
