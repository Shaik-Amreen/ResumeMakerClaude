import fs from 'fs';
import path from 'path';
import { sanitizeResumeLatex } from './sanitizeLatex';
import type { enforceMasterRules as EnforceMasterRulesFn } from './enforceMasterRules';

function applyMasterRules(latex: string): string {
  // Lazy require avoids circular init with extractLatex → amazonLatexGuard → enforceMasterRules
  const { enforceMasterRules } = require('./enforceMasterRules') as {
    enforceMasterRules: typeof EnforceMasterRulesFn;
  };
  return enforceMasterRules(latex);
}

const TEMPLATE_CANDIDATES = [
  path.join(__dirname, '../../data/resume-assets/amazonResumeTemplate.tex'),
  // When compiled to dist/, assets live under src/
  path.join(__dirname, '../../../src/data/resume-assets/amazonResumeTemplate.tex'),
  path.join(process.cwd(), 'src/data/resume-assets/amazonResumeTemplate.tex'),
];

function resolveAmazonTemplatePath(): string {
  for (const p of TEMPLATE_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return TEMPLATE_CANDIDATES[0];
}

let cachedTemplate = '';

function loadAmazonTemplate(): string {
  cachedTemplate = fs.readFileSync(resolveAmazonTemplatePath(), 'utf8');
  return cachedTemplate;
}

/** Preamble + \begin{document} + centered header from Karthik standard template. */
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

/** Fixed contact suffix on the title header line (plain text length). */
const HEADER_CONTACT_PLAIN =
  'karthikkovik@gmail.com | +1 (562) 284-0297 | California, USA';

/** ~one Times 11pt header line on letter paper with template margins. */
export const MAX_HEADER_LINE_PLAIN = 98;

/**
 * Collapse long JD titles to short header roles:
 * Software Engineer, Backend Engineer, Frontend Engineer, Full Stack Engineer, etc.
 */
export function shortenHeaderRoleTitle(
  rawTitle?: string,
  jobDescription?: string
): string {
  const blob = `${rawTitle || ''} ${jobDescription || ''}`.toLowerCase();
  const title = (rawTitle || '').replace(/\s+/g, ' ').trim();

  if (/\b(?:full[\s-]?stack|fullstack)\b/i.test(blob)) return 'Full Stack Engineer';
  if (/\b(?:front[\s-]?end|frontend|react\s+native|ui\s+engineer|mobile\s+engineer)\b/i.test(blob)) {
    if (/\breact\s+native|mobile\b/i.test(blob)) return 'Mobile Engineer';
    return 'Frontend Engineer';
  }
  if (/\b(?:back[\s-]?end|backend|platform\s+engineer|server[\s-]?side|api\s+engineer)\b/i.test(blob)) {
    return 'Backend Engineer';
  }
  if (/\b(?:data\s+engineer|ml\s+engineer|machine\s+learning|ai\s+engineer)\b/i.test(blob)) {
    if (/\bdata\s+engineer\b/i.test(blob)) return 'Data Engineer';
    return 'ML Engineer';
  }
  if (/\b(?:devops|sre|site\s+reliability|infrastructure\s+engineer|cloud\s+engineer)\b/i.test(blob)) {
    if (/\bsre|site\s+reliability\b/i.test(blob)) return 'SRE';
    if (/\bdevops\b/i.test(blob)) return 'DevOps Engineer';
    return 'Cloud Engineer';
  }
  if (/\b(?:security\s+engineer)\b/i.test(blob)) return 'Security Engineer';
  if (/\b(?:android\s+engineer|ios\s+engineer)\b/i.test(blob)) {
    return /\bandroid\b/i.test(blob) ? 'Android Engineer' : 'iOS Engineer';
  }
  if (/\b(?:new\s+grad|university\s+grad|entry[\s-]?level|junior)\b/i.test(blob) && /\bsoftware\b/i.test(blob)) {
    return 'Software Engineer';
  }

  // Already short enough (and not seniority / new-grad noise)
  if (
    title &&
    title.length <= 28 &&
    !/\bat\b|\||,/i.test(title) &&
    !/\b(?:new\s+grad|university|entry|junior|associate|sde\s*i{0,3}|\bi{1,3}\b)\b/i.test(title)
  ) {
    const cleaned = title.replace(/[{}%\\]/g, '');
    if (/engineer|developer/i.test(cleaned)) return cleaned;
  }

  if (/\bsde\b/i.test(title) || /\bsoftware\s+development\s+engineer\b/i.test(title)) {
    return 'Software Engineer';
  }

  // Strip company / seniority noise from JD title
  let t = title
    .replace(/\b(?:new\s+grad(?:uate)?|university\s+grad(?:uate)?|entry[\s-]?level|junior|associate|i{1,3}|1|2)\b/gi, '')
    .replace(/\b(?:full[\s-]?time|remote|hybrid|on[\s-]?site)\b/gi, '')
    .replace(/\s*[-–—|].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bsoftware\s+(?:engineer|developer|development\s+engineer)\b/i.test(t) || /\bsde\b/i.test(t)) {
    return 'Software Engineer';
  }
  if (/\bdeveloper\b/i.test(t) && !/\bengineer\b/i.test(t)) return 'Software Developer';
  if (/\bengineer\b/i.test(t)) {
    const short = t.replace(/[{}%\\]/g, '').slice(0, 28).trim();
    return short || 'Software Engineer';
  }

  return 'Software Engineer';
}

/**
 * Lock header to Karthik standard (EXACTLY 3 LINES):
 * Line 1: KARTHIK KOVI
 * Line 2: Title | [Open to Relocate] | Email | Phone | [California, USA]
 * Line 3: LinkedIn | [Portfolio] | GitHub
 * Prunes low-priority details (Open to Relocate -> California, USA -> Portfolio) if any line exceeds MAX_HEADER_LINE_PLAIN.
 */
export function applyJdHeaderTagline(
  latex: string,
  opts?: { title?: string; jobDescription?: string; company?: string }
): string {
  const safeTitle = shortenHeaderRoleTitle(opts?.title, opts?.jobDescription).replace(/[{}%\\]/g, '');

  const email = '\\href{mailto:karthikkovik@gmail.com}{karthikkovik@gmail.com}';
  const phone = '\\href{tel:+15622840297}{+1 (562) 284-0297}';
  const relocate = '{Open to Relocate}';
  const location = 'California, USA';

  // Determine line 2 items based on plain length (target <= MAX_HEADER_LINE_PLAIN)
  let includeRelocate = true;
  let includeLocation = true;

  const getLine2Plain = (rel: boolean, loc: boolean) => {
    const p = [safeTitle];
    if (rel) p.push('Open to Relocate');
    p.push('karthikkovik@gmail.com', '+1 (562) 284-0297');
    if (loc) p.push('California, USA');
    return p.join(' | ');
  };

  if (getLine2Plain(true, true).length > MAX_HEADER_LINE_PLAIN) {
    includeRelocate = false;
  }
  if (getLine2Plain(false, true).length > MAX_HEADER_LINE_PLAIN) {
    includeLocation = false;
  }

  const line2Parts: string[] = [`{${safeTitle}}`];
  if (includeRelocate) line2Parts.push(relocate);
  line2Parts.push(email, phone);
  if (includeLocation) line2Parts.push(location);
  const line2Code = line2Parts.join(' \\,\\textbar\\, ') + '\\\\';

  // Determine line 3 items
  const linkedin = '\\href{https://www.linkedin.com/in/karthikkovi}{linkedin.com/in/karthikkovi}';
  const portfolio = '\\href{https://karthikkovi.com}{karthikkovi.com}';
  const github = '\\href{https://github.com/kovikarthik}{github.com/kovikarthik}';

  let includePortfolio = true;
  const getLine3Plain = (port: boolean) => {
    const p = ['linkedin.com/in/karthikkovi'];
    if (port) p.push('karthikkovi.com');
    p.push('github.com/kovikarthik');
    return p.join(' | ');
  };

  if (getLine3Plain(true).length > MAX_HEADER_LINE_PLAIN) {
    includePortfolio = false;
  }

  const line3Parts: string[] = [linkedin];
  if (includePortfolio) line3Parts.push(portfolio);
  line3Parts.push(github);
  const line3Code = line3Parts.join(' \\,\\textbar\\, ');

  const newHeaderBlock = [
    '\\begin{center}',
    ' \\textbf{\\Huge \\scshape Karthik Kovi}\\\\[-2pt]',
    ` ${line2Code}`,
    ` ${line3Code}`,
    '\\end{center}',
  ].join('\n');

  if (/\\begin\{center\}[\s\S]*?\\end\{center\}/i.test(latex)) {
    return latex.replace(/\\begin\{center\}[\s\S]*?\\end\{center\}/i, newHeaderBlock);
  }

  return latex.replace(
    /(\\begin\{document\}\s*)/i,
    `$1\n${newHeaderBlock}\n\n`
  );
}

const FORBIDDEN_NAME =
  /\b(Allen\s+Sun|Nitin\s+Maddi|John\s+Doe|Jane\s+Doe|Your\s+Name|Candidate\s+Name|Amreen\s+Kousar|Shaik\s+Amreen)\b/i;
const FORBIDDEN_EMPLOYER = /\bRedbee(?:\s+(?:Technologies|365(?:\s+Studio)?))?\b/i;
const FORBIDDEN_PACKAGES = /\\usepackage\{fontspec\}|\\setmainfont/i;
const ALLOWED_TECTONIC_FONT =
  /\\usepackage\{fontspec\}[\s\S]*?\\setmainfont\{(?:TeX Gyre Termes|Times New Roman)\}/i;
const CANDIDATE_NAME = /Karthik\s+Kovi/i;

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
  if (FORBIDDEN_PACKAGES.test(body) && !ALLOWED_TECTONIC_FONT.test(body)) {
    return 'body contains fontspec';
  }
  if (FORBIDDEN_NAME.test(body)) return 'body contains wrong person name';
  if (FORBIDDEN_EMPLOYER.test(body)) return 'body contains removed employer Redbee';
  for (const env of ['itemize', 'enumerate', 'center']) {
    const { open, close } = countEnv(body, env);
    if (open !== close) return `unbalanced ${env} (${open} begin / ${close} end)`;
  }
  const amp = body.replace(/\\&/g, '').match(/&/g);
  if (amp && amp.length > 8) return 'too many raw & characters';
  if (!/\\section\{\\textbf\{Work Experience\}\}/i.test(body) && !/\\section\{Work Experience\}/i.test(body)) {
    return 'missing Work Experience section';
  }
  if (!/\\section\{\\textbf\{Skills\}\}/i.test(body) && !/\\section\{Skills\}/i.test(body)) {
    return 'missing Skills section';
  }
  if (!/\\section\{\\textbf\{Key Projects\}\}/i.test(body) && !/\\section\{Key Projects\}/i.test(body)) {
    return 'missing Key Projects section';
  }
  if (!/\\section\{\\textbf\{Education\}\}/i.test(body) && !/\\section\{Education\}/i.test(body)) {
    return 'missing Education section';
  }
  return null;
}

export function checkAmazonLatex(latex: string): AmazonLatexCheck {
  const reasons: string[] = [];
  if (!/\\documentclass\[letterpaper,11pt\]\{article\}/i.test(latex)) {
    reasons.push('wrong/missing letterpaper 11pt documentclass');
  }
  if (!/\\usepackage\{times\}/i.test(latex)) reasons.push('missing times package');
  if (!/\\usepackage\[normalem\]\{ulem\}/i.test(latex) && !/\\usepackage\{ulem\}/i.test(latex)) {
    reasons.push('missing ulem (for \\uline companies)');
  }
  if (!/\\begin\{document\}/i.test(latex)) reasons.push('missing \\begin{document}');
  if (!/\\end\{document\}/i.test(latex)) reasons.push('missing \\end{document}');
  if (!CANDIDATE_NAME.test(latex)) reasons.push('missing candidate name Karthik Kovi');
  if (FORBIDDEN_NAME.test(latex)) reasons.push('hallucinated wrong person name');
  if (FORBIDDEN_EMPLOYER.test(latex)) reasons.push('includes removed employer Redbee');
  if (FORBIDDEN_PACKAGES.test(latex) && !ALLOWED_TECTONIC_FONT.test(latex)) {
    reasons.push('forbidden fontspec/setmainfont');
  }
  if (!/\\section\{\\textbf\{Work Experience\}\}/i.test(latex)) reasons.push('missing Work Experience section');
  if (!/\\section\{\\textbf\{Skills\}\}/i.test(latex)) reasons.push('missing Skills section');
  if (!/\\section\{\\textbf\{Key Projects\}\}/i.test(latex)) reasons.push('missing Key Projects section');
  if (!/\\section\{\\textbf\{Education\}\}/i.test(latex)) reasons.push('missing Education section');
  if (!/\\vspace\{2pt\}/i.test(latex)) reasons.push('missing \\vspace{2pt} section gaps');
  if (!/\\begin\{itemize\}\[itemsep=2pt,\s*topsep=2pt,\s*parsep=0pt,\s*partopsep=0pt,\s*leftmargin=10pt\]/i.test(latex)) {
    reasons.push('missing template itemize spacing options');
  }
  if (!/\\uline\{\\textbf\{/i.test(latex)) reasons.push('missing \\uline{\\textbf{...}} company/school chrome');
  if (!/\\textbf\{\\Huge \\scshape Karthik Kovi\}/i.test(latex)) {
    reasons.push('missing bold small-caps name chrome');
  }
  for (const env of ['itemize', 'enumerate']) {
    const { open, close } = countEnv(latex, env);
    if (open !== close) reasons.push(`unbalanced ${env}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Force Karthik standard template: locked preamble/header + model body from first \section.
 */
export function enforceAmazonLatex(modelOutput: string): string {
  const { shellBeforeBody, fullTemplate } = amazonTemplateShell();
  let body = modelOutput.trim();

  const fence = body.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) body = fence[1].trim();

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

  const sectionIdx = body.search(
    /\\section\*?(\s*\{\\textbf\{|\s*\{\s*)(Work Experience|Skills|Key Projects|Education|Certificat|Professional|Technical|Featured)/i
  );
  if (sectionIdx > 0) {
    body = body.slice(sectionIdx);
  } else if (sectionIdx < 0) {
    console.warn('⚠️ No template section found — falling back to amazonResumeTemplate.tex');
    return sanitizeResumeLatex(fullTemplate);
  }

  // Normalize alternate section names to Karthik standard template
  body = body
    .replace(/\\section\*?\s*\{\\textbf\{Professional Experience\}\}/gi, '\\section{\\textbf{Work Experience}}')
    .replace(/\\section\*?\s*\{\\textbf\{Technical Skills\}\}/gi, '\\section{\\textbf{Skills}}')
    .replace(/\\section\*?\s*\{\\textbf\{Featured Projects\}\}/gi, '\\section{\\textbf{Key Projects}}')
    .replace(/\\section\*?\s*\{Professional Experience\}/gi, '\\section{\\textbf{Work Experience}}')
    .replace(/\\section\*?\s*\{Technical Skills\}/gi, '\\section{\\textbf{Skills}}')
    .replace(/\\section\*?\s*\{Featured Projects\}/gi, '\\section{\\textbf{Key Projects}}');

  // Revise prompts used to say "start at Education" — recover tailored Skills/Projects
  // by splicing template Work Experience instead of nuking the whole body.
  if (
    !/\\section\{\\textbf\{Work Experience\}\}/i.test(body) &&
    !/\\section\{Work Experience\}/i.test(body) &&
    /\\section\{\\textbf\{(?:Skills|Key Projects|Education)\}/i.test(body)
  ) {
    const we = fullTemplate.match(
      /\\section\{\\textbf\{Work Experience\}\}[\s\S]*?(?=\\section\{\\textbf\{Skills\}\})/i
    );
    const restIdx = body.search(
      /\\section\{\\textbf\{(?:Skills|Key Projects|Education|Certificat)/i
    );
    if (we && restIdx >= 0) {
      console.warn(
        '⚠️ Missing Work Experience — splicing template experience; keeping later tailored sections'
      );
      body = `${we[0].trim()}\n\n${body.slice(restIdx).trim()}`;
    }
  }

  const structural = bodyLooksStructurallyBroken(body);
  if (body.length < 800 || structural) {
    console.warn(
      `⚠️ Model body unusable (${structural || 'too short'}) — falling back to amazonResumeTemplate.tex`
    );
    return sanitizeResumeLatex(fullTemplate);
  }

  let assembled = `${shellBeforeBody}\n${body}\n\\end{document}\n`;
  assembled = applyMasterRules(assembled);
  assembled = applyJdHeaderTagline(assembled);

  const check = checkAmazonLatex(assembled);
  if (!check.ok || FORBIDDEN_NAME.test(assembled) || !CANDIDATE_NAME.test(assembled)) {
    console.warn(`⚠️ Template check failed (${check.reasons.join('; ')}) — using standard template`);
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
    'CRITICAL: Your LaTeX must match Karthik Overleaf template EXACTLY (bold map + gaps).',
    'Do NOT invent another person, template, fontspec, A4 geometry, or alternate bold scheme.',
    'Candidate name MUST be Karthik Kovi as \\textbf{\\Huge \\scshape Karthik Kovi}.',
    'After every \\section{\\textbf{...}} use \\vspace{2pt}.',
    'Experience itemize MUST be [itemsep=2pt, topsep=2pt, parsep=0pt, partopsep=0pt, leftmargin=10pt].',
    'Companies/schools: \\uline{\\textbf{...}}. Bold tech+metrics in bullets; stacks after \\textbar NOT bold.',
    'Output ONLY section content starting at \\section{\\textbf{Work Experience}} through Certifications.',
    'Section order: Work Experience → Skills → Key Projects → Education → Certifications.',
    'Do NOT output \\documentclass or preamble — the pipeline locks the preamble/header.',
    reasons.length ? `Problems detected: ${reasons.join('; ')}.` : '',
    'Keep Amazon Software Engineer Intern as first experience (then ASI, Infobell). EXACTLY 1 page — never 2.',
  ]
    .filter(Boolean)
    .join(' ');
}
