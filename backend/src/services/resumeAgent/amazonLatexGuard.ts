import fs from 'fs';
import path from 'path';
import { sanitizeResumeLatex } from './sanitizeLatex';

const TEMPLATE_PATH = path.join(__dirname, '../../data/resume-assets/amazonResumeTemplate.tex');

let cachedTemplate = '';

function loadAmazonTemplate(): string {
  // Always re-read so template edits (2-page lock) apply without process restart.
  cachedTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return cachedTemplate;
}

/** Preamble + \begin{document} + centered header from amazon.pdf template. */
export function amazonTemplateShell(): { shellBeforeBody: string; fullTemplate: string } {
  const template = loadAmazonTemplate();
  const center = template.match(/\\begin\{center\}[\s\S]*?\\end\{center\}/);
  if (!center) {
    throw new Error('amazonResumeTemplate.tex missing centered header');
  }
  const beginIdx = template.indexOf('\\begin{document}');
  if (beginIdx < 0) throw new Error('amazonResumeTemplate.tex missing \\begin{document}');
  const preamble = template.slice(0, beginIdx + '\\begin{document}'.length);
  const shellBeforeBody = `${preamble}\n\n${center[0]}\n`;
  return { shellBeforeBody, fullTemplate: template };
}

export function getAmazonTemplateLatex(): string {
  return applyJdHeaderTagline(sanitizeResumeLatex(loadAmazonTemplate()));
}

/** Role / title / skills line in the centered header (any variant). */
const HEADER_ROLE_LINE_RE =
  /^\s*\{[^}\n]*(?:Software Engineer|Full-Stack|Frontend|Backend|Distributed Systems|MS Computer Science)[^}\n]*\}\s*\\,\s*\\textbar\\,\s*$/gim;

const HEADER_ROLE_INLINE_RE =
  /\{Software Engineer\s*\\,\s*\\textbar\\,\s*Distributed Systems\s*\\&\s*Cloud(?:\s*\\,\s*\\textbar\\,\s*MS Computer Science,\s*CSULB)?\}\s*\\,\s*\\textbar\\,\s*/gi;

/**
 * Remove title / role / skills from the header.
 * Header keeps name + email + phone + location + LinkedIn + Portfolio only.
 */
export function applyJdHeaderTagline(
  latex: string,
  _opts?: { title?: string; jobDescription?: string; company?: string }
): string {
  return latex
    .replace(HEADER_ROLE_INLINE_RE, '')
    .replace(HEADER_ROLE_LINE_RE, '')
    // Any leftover "Software Engineer | … | MS …" block before the mailto line
    .replace(
      /\{\s*(?:Software Engineer|Full-Stack Web Developer|Frontend Engineer|Backend Engineer)[^}]*\}\s*\\,\s*\\textbar\\,\s*(?=\\href\{mailto:)/gi,
      ''
    );
}

const FORBIDDEN_NAME =
  /\b(Allen\s+Sun|Nitin\s+Maddi|John\s+Doe|Jane\s+Doe|Your\s+Name|Candidate\s+Name|Amreen\s+Kousar|Shaik\s+Amreen)\b/i;
const FORBIDDEN_PACKAGES = /\\usepackage\{fontspec\}|\\setmainfont/i;

export interface AmazonLatexCheck {
  ok: boolean;
  reasons: string[];
}

function countEnv(latex: string, name: string): { open: number; close: number } {
  const open = (latex.match(new RegExp(`\\\\begin\\{${name}\\}`, 'gi')) || []).length;
  const close = (latex.match(new RegExp(`\\\\end\\{${name}\\}`, 'gi')) || []).length;
  return { open, close };
}

function bodyLooksStructurallyBroken(body: string): string | null {
  if (/\\documentclass/i.test(body)) return 'body still contains \\documentclass';
  if (FORBIDDEN_PACKAGES.test(body)) return 'body contains fontspec';
  if (FORBIDDEN_NAME.test(body)) return 'body contains wrong person name';
  for (const env of ['itemize', 'enumerate', 'center']) {
    const { open, close } = countEnv(body, env);
    if (open !== close) return `unbalanced ${env} (${open} begin / ${close} end)`;
  }
  // Unescaped & outside known safe patterns often breaks tabular-less resumes
  const amp = body.replace(/\\&/g, '').match(/&/g);
  if (amp && amp.length > 8) return 'too many raw & characters';
  if (!/\\section\{\\textbf\{Education\}\}/i.test(body) && !/\\section\{Education\}/i.test(body)) {
    return 'missing Education section';
  }
  if (
    !/\\section\{\\textbf\{Technical Skills\}\}/i.test(body) &&
    !/\\section\{\\textbf\{Skills\}\}/i.test(body) &&
    !/\\section\{Technical Skills\}/i.test(body)
  ) {
    return 'missing Technical Skills section';
  }
  if (!/\\section\{\\textbf\{Professional Experience\}/i.test(body) && !/\\section\{\\textbf\{Work Experience\}/i.test(body)) {
    return 'missing Professional Experience section';
  }
  return null;
}

export function checkAmazonLatex(latex: string): AmazonLatexCheck {
  const reasons: string[] = [];
  if (!/\\documentclass\[letterpaper,11pt\]\{article\}/i.test(latex)) {
    reasons.push('wrong/missing letterpaper 11pt documentclass');
  }
  if (!/\\usepackage\{times\}/i.test(latex)) reasons.push('missing times package');
  if (!/\\begin\{document\}/i.test(latex)) reasons.push('missing \\begin{document}');
  if (!/\\end\{document\}/i.test(latex)) reasons.push('missing \\end{document}');
  if (!/KARTHIK\s+KOVI|Karthik\s+Kovi/i.test(latex)) reasons.push('missing candidate name Karthik Kovi');
  if (FORBIDDEN_NAME.test(latex)) reasons.push('hallucinated wrong person name');
  if (FORBIDDEN_PACKAGES.test(latex)) reasons.push('forbidden fontspec/setmainfont');
  if (!/\\section\{\\textbf\{Education\}\}/i.test(latex) && !/\\section\{Education\}/i.test(latex)) {
    reasons.push('missing Education section');
  }
  if (
    !/\\section\{\\textbf\{Technical Skills\}\}/i.test(latex) &&
    !/\\section\{\\textbf\{Skills\}\}/i.test(latex)
  ) {
    reasons.push('missing Technical Skills section');
  }
  for (const env of ['itemize', 'enumerate']) {
    const { open, close } = countEnv(latex, env);
    if (open !== close) reasons.push(`unbalanced ${env}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Force amazon.pdf structure: locked preamble/header + model body from first \section.
 * Prevents llama from inventing wrong templates/names.
 */
export function enforceAmazonLatex(modelOutput: string): string {
  const { shellBeforeBody, fullTemplate } = amazonTemplateShell();
  let body = modelOutput.trim();

  const fence = body.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) body = fence[1].trim();

  // If input is already a locked amazon doc, extract body after header for re-lock
  body = body
    .replace(/^[\s\S]*?\\begin\{document\}/i, '')
    .replace(/\\end\{document\}[\s\S]*$/i, '')
    .replace(/\\begin\{center\}[\s\S]*?\\end\{center\}/i, '')
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]+\}/gi, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]+\}/gi, '')
    .replace(/\\usepackage\{fontspec\}[\s\S]*?\n/gi, '')
    .replace(/\\setmainfont\{[^}]*\}/gi, '')
    .replace(/\\input\{glyphtounicode\}/gi, '')
    .replace(/\\pdfgentounicode\s*=\s*1/gi, '')
    .replace(/\\pagestyle\{[^}]+\}/gi, '')
    .replace(/\\fancyhf\{\}/gi, '')
    .replace(/\\fancyfoot\{\}/gi, '')
    .replace(/\\renewcommand\{\\headrulewidth\}\{[^}]*\}/gi, '')
    .replace(/\\renewcommand\{\\footrulewidth\}\{[^}]*\}/gi, '')
    .replace(/\\addtolength\{[^}]+\}\{[^}]+\}/gi, '')
    .replace(/\\setlength\{[^}]+\}\{[^}]+\}/gi, '')
    .replace(/\\titleformat\{[^}]+\}[^\n]*/gi, '')
    .replace(/\\titlespacing\*\{[^}]+\}[^\n]*/gi, '')
    .replace(/\\setlist\[[^\]]*\]\{[^}]*\}/gi, '')
    .replace(/\\urlstyle\{[^}]+\}/gi, '')
    .trim();

  // Drop any invented header before the first section
  const sectionIdx = body.search(
    /\\section\*?(\s*\{\\textbf\{|\s*\{\s*)(Education|Technical|Professional|Featured|Work|Skills|Publications|Certificat)/i
  );
  if (sectionIdx > 0) {
    body = body.slice(sectionIdx);
  } else if (sectionIdx < 0) {
    console.warn('⚠️ No amazon section found — falling back to amazonResumeTemplate.tex');
    return sanitizeResumeLatex(fullTemplate);
  }

  body = body
    .replace(/\\section\*?\s*\{\\textbf\{Work Experience\}\}/gi, '\\section{\\textbf{Professional Experience}}')
    .replace(/\\section\*?\s*\{\\textbf\{Skills\}\}/gi, '\\section{\\textbf{Technical Skills}}')
    .replace(/\\section\*?\s*\{\\textbf\{Key Projects\}\}/gi, '\\section{\\textbf{Featured Projects}}')
    .replace(/\\section\*?\s*\{Work Experience\}/gi, '\\section{\\textbf{Professional Experience}}')
    .replace(/\\section\*?\s*\{Skills\}/gi, '\\section{\\textbf{Technical Skills}}');

  const structural = bodyLooksStructurallyBroken(body);
  if (body.length < 800 || structural) {
    console.warn(
      `⚠️ Model body unusable (${structural || 'too short'}) — falling back to amazonResumeTemplate.tex`
    );
    return sanitizeResumeLatex(fullTemplate);
  }

  let assembled = `${shellBeforeBody}\n${body}\n\\end{document}\n`;
  assembled = sanitizeResumeLatex(assembled);
  // Never keep role/title/skills in the header (name + contact only).
  assembled = applyJdHeaderTagline(assembled);

  const check = checkAmazonLatex(assembled);
  if (!check.ok || FORBIDDEN_NAME.test(assembled) || !/KARTHIK\s+KOVI|Karthik\s+Kovi/i.test(assembled)) {
    console.warn(`⚠️ Amazon check failed (${check.reasons.join('; ')}) — using amazon template`);
    return applyJdHeaderTagline(sanitizeResumeLatex(fullTemplate));
  }

  assembled = assembled
    .replace(/\\usepackage\{fontspec\}.*\n/gi, '')
    .replace(/\\setmainfont\{[^}]*\}\s*/gi, '');

  if (!/\\documentclass\[letterpaper,11pt\]\{article\}/i.test(assembled)) {
    assembled = assembled.replace(
      /\\documentclass(\[[^\]]*\])?\{article\}/i,
      '\\documentclass[letterpaper,11pt]{article}'
    );
  }

  return assembled;
}

export function amazonStructureRepairInstruction(reasons: string[]): string {
  return [
    'CRITICAL: Your LaTeX must match amazon.pdf EXACTLY.',
    'Do NOT invent another person, template, fontspec, or A4 geometry.',
    'Candidate name MUST be KARTHIK KOVI.',
    'Output ONLY section content starting at \\section{\\textbf{Education}} through Certifications.',
    'Do NOT output \\documentclass or preamble — the pipeline locks the amazon preamble/header.',
    reasons.length ? `Problems detected: ${reasons.join('; ')}.` : '',
    'Keep ASI Software Developer as first experience. Exactly content for a 2-page amazon-style resume.',
  ]
    .filter(Boolean)
    .join(' ');
}
