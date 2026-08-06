/**
 * Post-process LaTeX for Karthik standard template hygiene.
 * Call after model output + sanitizeResumeLatex.
 * Forces visual lock: itemize gaps, \vspace{2pt}, section bold form, experience line chrome.
 */
import { sanitizeResumeLatex } from './sanitizeLatex';

/** Exact experience itemize options from amazonResumeTemplate.tex / Overleaf master. */
export const TEMPLATE_ITEMIZE_OPTS =
  'itemsep=2pt, topsep=2pt, parsep=0pt, partopsep=0pt, leftmargin=10pt';

/** ~one Times 11pt line on letter paper with template margins (plain text). */
export const MAX_BULLET_PLAIN_CHARS = 135;
/** Prefer bullets that fill most of the line (90-100% width) so the 1-page resume looks complete. */
export const TARGET_BULLET_PLAIN_CHARS = 120;

/** Trailing fluff / low-priority clauses safe to drop when compressing to one line. */
const LOW_PRIORITY_TRAILING =
  /\s*(?:,|;|\band\b)?\s*(?:with\s+(?:built-in\s+)?(?:safety\s+)?checks?(?:\s+and\s+[^.]+)?|ensuring\s+[^.]+|including\s+[^.]+|as\s+well\s+as\s+[^.]+|in\s+order\s+to\s+[^.]+|to\s+(?:ensure|support|enable|help|provide|maintain)\s+[^.]+|for\s+(?:operational\s+)?(?:readiness|consistency|scalability|compliance)(?:\s+[^.]+)?|across\s+the\s+(?:team|organization|platform)[^.]*|while\s+[^.]+|thereby\s+[^.]+|resulting\s+in\s+[^.]+)$/i;

const LOW_PRIORITY_PHRASES: RegExp[] = [
  /\b(?:successfully|effectively|efficiently|proactively|seamlessly|robust(?:ly)?|comprehensive(?:ly)?|various|multiple|several)\b/gi,
  /\b(?:in\s+order\s+to|as\s+well\s+as|in\s+addition\s+to)\b/gi,
  /\b(?:helping\s+to|aimed\s+at|designed\s+to\s+help)\b/gi,
  /\b(?:cutting[\s-]edge|state[\s-]of[\s-]the[\s-]art|holistic|impactful|synerg(?:y|ies|istic)|best[\s-]in[\s-]class)\b/gi,
  /\b(?:myriad|plethora|pivotal|showcase|foster|unlock|elevate)\b/gi,
  /\s*\([^)]{0,40}\)/g, // short parenthetical asides
];

/** Swap common LLM/resume-buzz verbs for Karthik template voice. */
const AI_VOICE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bleveraged\b/gi, 'Used'],
  [/\butilized\b/gi, 'Used'],
  [/\bspearheaded\b/gi, 'Led'],
  [/\borchestrated\b/gi, 'Built'],
  [/\bharnessed\b/gi, 'Used'],
  [/\bfacilitated\b/gi, 'Supported'],
  [/\bstreamlined\b/gi, 'Improved'],
  [/\brevolutioniz(?:e|ed|ing)\b/gi, 'Improved'],
  [/\bempower(?:ed|ing)?\b/gi, 'Enabled'],
  [/\bfoster(?:ed|ing)?\b/gi, 'Supported'],
  [/\bunlock(?:ed|ing)?\b/gi, 'Enabled'],
  [/\belevat(?:e|ed|ing)\b/gi, 'Improved'],
  [/\bdelve(?:d)?\s+into\b/gi, 'Worked on'],
  [/\bshowcas(?:e|ed|ing)\b/gi, 'Showed'],
  [/\bcutting[\s-]edge\b/gi, ''],
  [/\bstate[\s-]of[\s-]the[\s-]art\b/gi, ''],
  [/\bbest[\s-]in[\s-]class\b/gi, ''],
  [/\brobust\b/gi, ''],
  [/\bseamless(?:ly)?\b/gi, ''],
  [/\bsynerg(?:y|ies|istic)\b/gi, ''],
  [/\bholistic\b/gi, ''],
  [/\bimpactful\b/gi, ''],
  [/\bpivotal\b/gi, ''],
  [/\bmyriad\b/gi, ''],
  [/\bplethora\b/gi, ''],
  [/\bpassionate\b/gi, ''],
  [/\bexcited\s+to\b/gi, ''],
  [/\blandscape\b/gi, ''],
];

const INCOMPLETE_TAIL_WORD =
  /\b(?:with|and|or|for|in|on|to|the|a|an|of|by|as|at|from|into|via|using|including|ensuring|across|while|through|under|over|within|without|between|during|after|before|that|which|who)\s*$/i;

function plainBulletText(raw: string): string {
  return raw
    .replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textit\{([^}]*)\}/g, '$1')
    .replace(/\\texttt\{([^}]*)\}/g, '$1')
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, '$1')
    .replace(/\\%|\\&|\\\$|\\#|\\_/g, (m) => m.slice(1))
    .replace(/~/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dropLowPriorityPhrases(body: string): string {
  let out = body;
  // Drop trailing low-priority clause(s) repeatedly
  for (let i = 0; i < 4; i++) {
    const next = out.replace(LOW_PRIORITY_TRAILING, '').replace(/[,;:\s]+$/g, '').trim();
    if (next === out) break;
    out = next;
  }
  for (const re of LOW_PRIORITY_PHRASES) {
    out = out.replace(re, ' ');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
}

/** Replace LLM buzzwords with template-style verbs; strip leftover empty slots. */
export function humanizeBulletVoice(body: string): string {
  let out = body;
  for (const [re, rep] of AI_VOICE_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+\./g, '.')
    .trim();
}

/** Close truncated \textbf{...} and strip hanging prepositions so the line reads complete. */
export function finishCompleteBullet(body: string): string {
  let out = body.trim();

  // Balance \textbf{ opens
  const boldOpens = (out.match(/\\textbf\{/g) || []).length;
  let depth = 0;
  let closesNeeded = 0;
  for (let i = 0; i < out.length; i++) {
    if (out.slice(i).startsWith('\\textbf{')) {
      depth++;
      i += '\\textbf{'.length - 1;
      continue;
    }
    if (out[i] === '{' && out[i - 1] !== '\\') depth++;
    if (out[i] === '}' && depth > 0) depth--;
  }
  closesNeeded = depth;
  if (closesNeeded > 0) out += '}'.repeat(closesNeeded);

  out = out.replace(/[,;:\s]+$/g, '').trim();

  // Strip incomplete trailing words ("… compliance in", "… with")
  for (let i = 0; i < 8; i++) {
    const plain = plainBulletText(out);
    if (!INCOMPLETE_TAIL_WORD.test(plain) && !INCOMPLETE_TAIL_WORD.test(out.replace(/\\textbf\{([^}]*)\}/g, '$1'))) {
      break;
    }
    const next = out.replace(/(?:\s|\\textbf\{)?[^\s{}]+\}?\s*$/g, '').replace(/[,;:\s]+$/g, '').trim();
    if (!next || next === out) break;
    out = next;
  }

  // Re-close any bold broken by the strip
  const opens = (out.match(/\\textbf\{/g) || []).length;
  const closeCount = (out.match(/\}/g) || []).length;
  // crude: if more opens than we'd expect, append }
  if (opens > 0) {
    let d = 0;
    for (let i = 0; i < out.length; i++) {
      if (out.slice(i).startsWith('\\textbf{')) {
        d++;
        i += '\\textbf{'.length - 1;
        continue;
      }
      if (out[i] === '}') d = Math.max(0, d - 1);
    }
    if (d > 0) out += '}'.repeat(d);
  }
  void closeCount;

  out = out.replace(/[,;:\s]+$/g, '').trim();
  if (out && !/[.!?]$/.test(out)) out = `${out}.`;
  return out;
}

/**
 * Shorten a single \item so plain text fits one printed line.
 * Prefer dropping low-priority words/clauses over mid-sentence hard cuts.
 * Always finish as a complete sentence (no hanging prepositions).
 */
export function shortenBulletToOneLine(itemBody: string, maxPlain = MAX_BULLET_PLAIN_CHARS): string {
  const prefix = itemBody.match(/^(\\item\b\s*)/i)?.[1] ?? '\\item ';
  let body = itemBody.replace(/^\\item\b\s*/i, '').trim();
  body = humanizeBulletVoice(body);

  if (plainBulletText(body).length <= maxPlain) {
    return `${prefix}${finishCompleteBullet(body)}`;
  }

  // 1) Drop low-priority fluff first (adverbs, trailing "ensuring/including/…" clauses)
  body = dropLowPriorityPhrases(body);
  body = humanizeBulletVoice(body);
  if (plainBulletText(body).length <= maxPlain) {
    return `${prefix}${finishCompleteBullet(body)}`;
  }

  // 2) Drop trailing clauses after ; or . (keep action + tech + metric)
  const clauses = body.split(/(?<=[.;])\s+/);
  while (clauses.length > 1 && plainBulletText(clauses.join(' ')).length > maxPlain) {
    clauses.pop();
  }
  body = clauses.join(' ').trim();
  if (plainBulletText(body).length <= maxPlain) {
    return `${prefix}${finishCompleteBullet(body)}`;
  }

  // 3) Drop trailing comma phrases (often secondary details)
  const commaParts = body.split(/,\s+/);
  while (commaParts.length > 2 && plainBulletText(commaParts.join(', ')).length > maxPlain) {
    commaParts.pop();
  }
  body = commaParts.join(', ').replace(/[,;:\s]+$/g, '').trim();
  if (plainBulletText(body).length <= maxPlain) {
    return `${prefix}${finishCompleteBullet(body)}`;
  }

  // 4) Hard trim at last space under limit — then force a complete ending
  let cut = body;
  while (plainBulletText(cut).length > maxPlain) {
    const plain = plainBulletText(cut);
    const target = plain.slice(0, maxPlain);
    const lastSpace = target.lastIndexOf(' ');
    const keepPlain = (lastSpace > 40 ? target.slice(0, lastSpace) : target).trim();
    const ratio = keepPlain.length / Math.max(plain.length, 1);
    const approx = Math.max(40, Math.floor(cut.length * ratio));
    const slice = cut.slice(0, approx);
    const sp = slice.lastIndexOf(' ');
    cut = (sp > 30 ? slice.slice(0, sp) : slice).replace(/[,;:\s]+$/g, '').trim();
    if (cut.length < 40) break;
  }
  return `${prefix}${finishCompleteBullet(cut)}`;
}

function beginItemize(): string {
  return `\\begin{itemize}[${TEMPLATE_ITEMIZE_OPTS}]`;
}

function enforceSingleLineBullets(latex: string): string {
  return latex.replace(
    /\\begin\{itemize\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/gi,
    (_full, inner: string) => {
      const items = [...inner.matchAll(/\\item\b[\s\S]*?(?=\\item\b|$)/gi)].map((m) =>
        shortenBulletToOneLine(m[0].trim())
      );
      return `${beginItemize()}\n  ${items.join('\n  ')}\n\\end{itemize}`;
    }
  );
}

function trimItemizeBlocks(latex: string, maxItems: number): string {
  return latex.replace(
    /\\begin\{itemize\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{itemize\}/gi,
    (_full, inner: string) => {
      const items = [...inner.matchAll(/\\item\b[\s\S]*?(?=\\item\b|$)/gi)].map((m) => m[0]);
      if (items.length <= maxItems) {
        return `${beginItemize()}${inner}\\end{itemize}`;
      }
      const kept = items.slice(0, maxItems).join('');
      return `${beginItemize()}\n${kept.trim()}\n\\end{itemize}`;
    }
  );
}

/**
 * Force visual chrome from the Overleaf master:
 * - \section{\textbf{Name}} + \vspace{2pt}
 * - experience itemize options
 * - company names wrapped in \uline{\textbf{...}} when missing
 * - Key Projects separated by \vspace{2pt}
 */
export function normalizeKarthikTemplateLayout(latex: string): string {
  let out = latex;

  // Canonical section titles (bold) + mandatory post-section gap
  const sections = [
    'Work Experience',
    'Skills',
    'Key Projects',
    'Education',
    'Certifications',
  ];
  for (const name of sections) {
    const re = new RegExp(
      `\\\\section\\*?\\s*\\{(?:\\\\textbf\\{)?${name.replace(/\s+/g, '\\s+')}(?:\\})?\\}\\s*(?:\\\\vspace\\{[^}]+\\})?`,
      'gi'
    );
    out = out.replace(re, `\\section{\\textbf{${name}}}\n\\vspace{2pt}`);
  }

  // Force every itemize to template options (even outside experience rewrite paths)
  out = out.replace(
    /\\begin\{itemize\}(?:\[[^\]]*\])?/gi,
    beginItemize()
  );

  // Experience/education company: bare "\hfill CompanyName \hfill" → uline+textbf
  out = out.replace(
    /(\\hfill)\s+([A-Za-z0-9][^\\\n]{1,80}?)(\s*(?:\\hfill|\\hspace\{0\.1em\}))/g,
    (_m, hfill: string, company: string, tail: string) => {
      const cleaned = company.trim().replace(/^\{|\}$/g, '');
      if (!cleaned || /\\/.test(cleaned)) return `${hfill} ${company}${tail}`;
      return `${hfill} \\uline{\\textbf{${cleaned}}}${tail}`;
    }
  );

  // Ensure \vspace{2pt} between Key Projects blocks (href/textbf project lines)
  out = out.replace(
    /(\\section\{\\textbf\{Key Projects\}\}\n\\vspace\{2pt\})([\s\S]*?)(?=\\section\{\\textbf\{Education\}\})/i,
    (_full, head: string, body: string) => {
      let projects = body.trim();
      // Insert vspace before project title lines that lack one (except first)
      projects = projects.replace(
        /\n(?!\\vspace)((?:\\href\{[^}]+\}\{\\textbf\{|\\textbf\{)[^}\n]+(?:\}\})?\s*\\,\s*\\textbar)/g,
        '\n\n\\vspace{2pt}\n$1'
      );
      // Collapse duplicate vspaces
      projects = projects.replace(/(?:\\vspace\{2pt\}\s*){2,}/g, '\\vspace{2pt}\n');
      return `${head}\n${projects.trim()}\n\n`;
    }
  );

  return out;
}

/** Cap Work Experience bullets at 5 (Karthik standard template). */
function enforceBulletCaps(latex: string): string {
  const parts = latex.split(/(\\section\{\\textbf\{[^}]+\}\})/i);
  let out = '';
  let mode: 'exp' | 'other' = 'other';

  for (const part of parts) {
    if (
      /\\section\{\\textbf\{Work Experience\}\}/i.test(part) ||
      /\\section\{\\textbf\{Professional Experience\}\}/i.test(part)
    ) {
      mode = 'exp';
      out += part;
      continue;
    }
    if (/\\section\{\\textbf\{/i.test(part)) {
      mode = 'other';
      out += part;
      continue;
    }
    out += mode === 'exp' ? trimItemizeBlocks(part, 5) : part;
  }
  return out;
}

/** Prefer not mixing C++ with Node/Python/Java/Go on the same tech line. */
function enforceCppSoleBackend(latex: string): string {
  return latex.replace(/\\textit\{([^}]*)\}/g, (full, inner: string) => {
    if (!/\bC\+\+/i.test(inner)) return full;
    if (!/\b(?:Node(?:\.?js)?|Express|Python|Java(?!\s*Script)|Go(?:lang)?|Spring)\b/i.test(inner)) {
      return full;
    }
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

/** Strip Redbee / older roles removed from the resume template. */
function stripRemovedEmployers(latex: string): string {
  let out = latex.replace(
    /\\textbf\{Software Engineer Intern\}[\s\S]*?Redbee[\s\S]*?\\end\{itemize\}/gi,
    ''
  );
  // Orphan date-only headers left after a partial strip
  out = out.replace(/\n\\textbf\{\d{2}\/\d{4}\s*-\s*\d{2}\/\d{4}\}\s*(?:\n|$)/g, '\n');
  out = out.replace(/\bRedbee(?:\s+(?:Technologies|365(?:\s+Studio)?))?\b/gi, '');
  return out;
}

/** Cap Key Projects at 5 (1-page template volume). */
function capKeyProjects(latex: string, maxProjects = 5): string {
  const m = latex.match(
    /(\\section\{\\textbf\{Key Projects\}\}\s*(?:\\vspace\{[^}]+\})?\s*)([\s\S]*?)(?=\\section\{\\textbf\{(?:Education|Certifications)\}|$)/i
  );
  if (!m) return latex;

  const head = m[1];
  const body = m[2];
  const blocks = body.split(/(?=\\vspace\{2pt\}|(?:^|\n)(?:\\href\{[^}]+\}\{\\textbf\{|\\textbf\{)[^}\n]*(?:\}\})?\s*\\,\s*\\textbar)/i);
  const projects = blocks
    .map((b) => b.trim())
    .filter((b) => /\\textbar/i.test(b) || /\\textbf\{[^}]+(?:--| - )/i.test(b));
  if (projects.length <= maxProjects) return latex;

  const kept = projects.slice(0, maxProjects).join('\n\n\\vspace{2pt}\n');
  const rebuilt = `${head}\n${kept}\n\n`;
  return latex.replace(m[0], rebuilt);
}

/**
 * Apply mechanical guards on model LaTeX for Karthik template.
 * Keeps Open to Relocate + GPA (present in standard template).
 * Forces experience bullets onto one printed line; caps volume for 1 page.
 */
export function enforceMasterRules(latex: string): string {
  let out = sanitizeResumeLatex(latex);
  out = stripRemovedEmployers(out);
  out = normalizeKarthikTemplateLayout(out);
  out = enforceBulletCaps(out);
  out = capKeyProjects(out, 5);
  out = enforceSingleLineBullets(out);
  out = normalizeKarthikTemplateLayout(out); // re-apply itemize opts after bullet rewrite
  out = enforceCppSoleBackend(out);
  out = sanitizeResumeLatex(out);
  return out;
}
