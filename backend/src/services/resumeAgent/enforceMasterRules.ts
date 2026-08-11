/**
 * Post-process LaTeX to mechanically enforce Master Rules 5/6/18/20/21/22
 * (and related hygiene). Call after model output + sanitizeResumeLatex.
 */
import { sanitizeResumeLatex } from './sanitizeLatex';

/**
 * Cap \\item count inside each itemize to `max`, but keep at least `min` if present
 * (does not invent bullets — only trims excess).
 */
function trimItemizeBlocks(latex: string, maxItems: number): string {
  return latex.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/gi, (_full, inner: string) => {
    const items = [...inner.matchAll(/\\item\b[\s\S]*?(?=\\item\b|$)/gi)].map((m) => m[0]);
    if (items.length <= maxItems) {
      return `\\begin{itemize}${inner}\\end{itemize}`;
    }
    const kept = items.slice(0, maxItems).join('');
    return `\\begin{itemize}\n${kept.trim()}\n\\end{itemize}`;
  });
}

/**
 * Rule 21: 3–4 bullets per work experience (trim to max 4).
 * Rule 22: 3–4 bullets per project (trim to max 4).
 */
function enforceBulletCaps(latex: string): string {
  const parts = latex.split(/(\\section\{\\textbf\{[^}]+\}\})/i);
  let out = '';
  let mode: 'exp' | 'proj' | 'other' = 'other';

  for (const part of parts) {
    if (/\\section\{\\textbf\{Professional Experience\}\}/i.test(part)) {
      mode = 'exp';
      out += part;
      continue;
    }
    if (/\\section\{\\textbf\{Featured Projects\}\}/i.test(part)) {
      mode = 'proj';
      out += part;
      continue;
    }
    if (/\\section\{\\textbf\{/i.test(part)) {
      mode = 'other';
      out += part;
      continue;
    }
    const max = mode === 'proj' || mode === 'exp' ? 4 : 4;
    out += trimItemizeBlocks(part, max);
  }
  return out;
}

/** Rule 18: never mix C++ with Node/Python/Java/Go on the same \\textit{…} tech line. */
function enforceCppSoleBackend(latex: string): string {
  return latex.replace(/\\textit\{([^}]*)\}/g, (full, inner: string) => {
    if (!/\bC\+\+/i.test(inner)) return full;
    if (!/\b(?:Node(?:\.?js)?|Express|Python|Java(?!\s*Script)|Go(?:lang)?|Spring)\b/i.test(inner)) {
      return full;
    }
    // Keep C++ + frontend frameworks; drop other backends
    let cleaned = inner
      .replace(/\bNode(?:\.?js)?\b/gi, '')
      .replace(/\bExpress(?:\.?js)?\b/gi, '')
      .replace(/\bPython\b/gi, '')
      .replace(/\bJava(?!\s*Script)\b/gi, '')
      .replace(/\bGo(?:lang)?\b/gi, '')
      .replace(/\bSpring(?:\s*Boot)?\b/gi, '')
      .replace(/[,;]\s*[,;]/g, ',')
      .replace(/^\s*[,;]\s*|\s*[,;]\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return `\\textit{${cleaned}}`;
  });
}

/** Rule 5: strip GPA / coursework / honors lines under Education. */
function enforceMinimalEducation(latex: string): string {
  return latex.replace(
    /(\\section\{\\textbf\{Education\}\}[\s\S]*?)(?=\\section\{\\textbf\{Technical Skills\}\}|\\section\{\\textbf\{)/i,
    (edu) =>
      edu
        .replace(/\\begin\{itemize\}[\s\S]*?\\end\{itemize\}/gi, '')
        .replace(/\bGPA\b[^\n\\]*/gi, '')
        .replace(/\bCoursework\b[^\n\\]*/gi, '')
        .replace(/\bHonors?\b[^\n\\]*/gi, '')
  );
}

/** Rule 20 */
function stripOpenToRelocate(latex: string): string {
  return latex
    .replace(/\s*[|,]?\s*Open to Relocate\b/gi, '')
    .replace(/\bOpen to Relocate\s*[|,]?\s*/gi, '');
}

/** Rule 15/8: strip GitHub project links from Featured Projects titles. */
function stripGithubProjectLinks(latex: string): string {
  return latex.replace(
    /\\href\{https?:\/\/(?:www\.)?github\.com[^}]*\}\{\\uline\{\\textbf\{([^}]*)\}\}\}/gi,
    '\\textbf{$1}'
  );
}

/**
 * Apply Master Rule mechanical guards on model LaTeX.
 * Always runs sanitizeResumeLatex (Languages allowlist, dashes, C++ versions).
 */
export function enforceMasterRules(latex: string): string {
  let out = sanitizeResumeLatex(latex);
  out = stripOpenToRelocate(out);
  out = enforceMinimalEducation(out);
  out = enforceBulletCaps(out);
  out = enforceCppSoleBackend(out);
  out = stripGithubProjectLinks(out);
  out = sanitizeResumeLatex(out); // Languages allowlist again after edits
  return out;
}
