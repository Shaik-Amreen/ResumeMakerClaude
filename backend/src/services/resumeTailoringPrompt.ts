import fs from 'fs';
import path from 'path';
import type { JobType } from '../models/Job';
import { loadOllamaChatRules } from './ollamaChatStore';
import { cleanJobDescriptionForResume } from './cleanJobDescription';
import { extractJdKeywords } from './resumeAgent/jdMatch';

const ASSETS_DIR = path.join(__dirname, '../data/resume-assets');

function readAsset(name: string): string {
  const filePath = path.join(ASSETS_DIR, name);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

/** Full instructions.txt (MASTER 22-rule book); LaTeX template loaded separately. */
function loadInstructionsText(): string {
  return readAsset('instructions.txt');
}

export interface ResumeJobContext {
  jobDescription: string;
  title?: string;
  company?: string;
  jobType?: JobType;
}

export function buildResumeSystemPrompt(ctx: ResumeJobContext): string {
  const instructions = loadInstructionsText();
  const chatRulesFile = readAsset('ollamaChatRules.txt');
  const chatRulesDb = loadOllamaChatRules();
  const template = readAsset('amazonResumeTemplate.tex');
  const baseResume = readAsset('baseResume-v10.txt');
  const profileCatalog = readAsset('profileCatalog.txt');
  const projectPool = readAsset('projectPool.txt');

  const gradRule =
    ctx.jobType === 'internship'
      ? 'INTERNSHIP — MS graduation date: January 2028.'
      : ctx.jobType === 'fulltime'
        ? 'FULL-TIME — MS graduation date: May 2027.'
        : 'Infer internship (Jan 2028 grad) vs full-time (May 2027 grad) from the JD.';

  const roleContext = [
    ctx.title && `Target role: ${ctx.title}`,
    ctx.company && `Target company: ${ctx.company}`,
    gradRule,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    '=== MASTER RULEBOOK (ALL 22 RULES — OBEY LITERALLY EVERY TIME) ===',
    'You MUST follow Rules 1–22 in instructions.txt exactly. No career advice. No commentary essays. Output LaTeX (+ MATCH_REPORT) only.',
    'Violations that are FORBIDDEN: JD prose in Languages/Skills; inventing facts/URLs; >4 bullets/job; >3 bullets/project; mixing C++ with Node/Python/Java/Go; Open to Relocate; dropping sections; copying template projects unchanged when they miss JD skills.',
    instructions,
    '',
    '=== COMPACT RULE REMINDER ===',
    chatRulesFile,
    chatRulesDb,
    '',
    roleContext,
    '',
    '=== CRITICAL: DO NOT COPY THE TEMPLATE CONTENT ===',
    'amazonResumeTemplate.tex is STRUCTURE ONLY (margins, sections, \\textbar).',
    'You MUST rewrite Technical Skills, experience bullets, and project stacks for THIS JD.',
    'If the JD asks for a skill missing from projects (e.g. PHP/C++) — put it into at most 2 project tech lines only (Rule 19). Do not rewrite all 5 stacks.',
    'Header has name + contact only — no job title, no skills, no "Distributed Systems & Cloud" line.',
    'Put every required JD skill into Skills AND into at least one experience/project bullet with evidence (Rule 1).',
    'Copying the template skills/projects unchanged is a FAILURE only when they miss JD-required skills.',
    '',
    '=== AMAZON.PDF LaTeX TEMPLATE (STRUCTURE ONLY) ===',
    'Keep section order and \\textbar design. ALWAYS keep ASI Web Developer first under Experience.',
    'Education: degree + school + dates ONLY (Rule 5). Experience: 3–4 bullets/job (Rule 21). Projects: 3–4 bullets each (Rule 22).',
    'Rule 7: pick EXACTLY top 5 from the FULL ~23-project pool below — NOT the template default set. At least 3 of 5 MUST be LINKED with real URLs.',
    'One frontend + one backend per project (Rules 8/14/18). NEVER mix C++ with Node/Python/Java/Go. Write "C++" only — never C++20/C++23. Never invent facts/URLs (Rule 9).',
    'Rule 19: change project stacks ONLY for unmatched JD skills, and ONLY in 2 projects max.',
    'Rule 1: EXACTLY 100% JD keyword coverage with evidenced bullets (not ~95%).',
    'AI / agents / LLM / Co-Pilot / data-science JDs: MUST include AWS AI Summer Camp in the top 5 while keeping ≥3 LINKED projects.',
    'Date ranges use LaTeX -- only. No Unicode em/en dashes.',
    '',
    template,
    '',
    '=== PROJECT POOL (Rule 7 — pick top 5 from HERE; ≥3 LINKED) ===',
    projectPool,
    '',
    '=== BASE RESUME TRUTH SOURCE (candidate facts; do not invent beyond this) ===',
    baseResume.slice(0, 10000),
    '',
    '=== DETAILED PROFILE CATALOG (extra verified roles/projects for JD match) ===',
    profileCatalog.slice(0, 9000),
    '',
    'FINAL CHECKLIST (Rules 1-22 — ALL REQUIRED):',
    '□ R1: every JD tech skill evidenced in a bullet (100%, not skills-list only)',
    '□ R2/R11: amazon Times LaTeX, exactly 2 pages',
    '□ R3: header name+contact only (pipeline locks)',
    '□ R4: Education → Skills → Experience → Projects → Pubs → Certs',
    '□ R5: Education = degree + school + dates ONLY',
    '□ R6: ASCII hyphens in prose; LaTeX -- for dates; no Unicode dashes',
    '□ R7: top 5 from FULL ~23 pool; ≥3 LINKED live URLs',
    '□ R8/R14/R18: one frontend + one backend; never mix competing frontends; C++ sole backend if used',
    '□ R9/R15: never invent or change facts/URLs; no GitHub project links',
    '□ R10/R16: pubs/certs as href titles; certs Name \\hfill Date',
    '□ R12/R19: change at most 2 project stacks for unmatched JD skills',
    '□ R13: co-founder ONLY if JD asks',
    '□ R17: workflow complete; R20 Long Beach CA only; R21 3–4 bullets/job; R22 3–4 bullets/project',
    '□ Languages = programming languages ONLY — never JD sentences',
    '□ ASI first; Amreen Kousar; no invented facts',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** User message: cleaned JD + strict generation command. */
export function buildResumeUserPrompt(jobDescription: string): string {
  const cleaned = cleanJobDescriptionForResume(jobDescription);
  if (!cleaned) throw new Error('Job description is empty.');

  const keywords = extractJdKeywords(cleaned);
  const keywordLine = keywords.length
    ? `JD KEYWORDS YOU MUST COVER (skills + evidenced bullets): ${keywords.join(', ')}`
    : 'Extract every required/preferred skill from the JD and cover each with evidence.';

  return [
    'TAILOR a NEW resume for THIS JD. Obey ALL 22 MASTER RULES. Do NOT paste the amazon template skills/projects unchanged.',
    'CRITICAL OUTPUT FORMAT:',
    '- Start EXACTLY at: \\section{\\textbf{Education}}',
    '- Then: Technical Skills (REWRITTEN for JD), Professional Experience (ASI first, bullets rewritten), Featured Projects (top 5 with JD-aligned stacks), Publications, Certifications.',
    '- End before \\end{document}. Do NOT output \\documentclass/packages/header — pipeline locks Amreen header.',
    '- Candidate name is ALWAYS Amreen Kousar.',
    '- NEVER copy HTML tags, &nbsp;, section headers like "Knowledge Skills Abilities", or raw JD sentences into Skills.',
    '- Languages line = programming languages ONLY (Python, Java, C++, …). NEVER paste JD phrases like "Build production systems" or "What You\'ll Bring".',
    '- Skills lines must be clean comma-separated technologies only (e.g. Java, C#, .NET, React, Docker).',
    '- Do NOT write career-advice essays, "overqualified" commentary, or soft-skill lectures in MATCH_REPORT notes.',
    keywordLine,
    'REWRITE RULES FOR THIS JD (tied to Master Rules):',
    '1) Technical Skills (R1/R19): reorder to put required JD skills first. Do not invent unrelated stacks. Languages = languages only.',
    '2) Featured Projects (R7): Rank ALL ~23 projects in the PROJECT POOL. Pick the TOP 5 for THIS JD. At least 3 MUST use real LINKED URLs from the pool. Do NOT default to the amazon template\'s NativeNest/Origem/B4IGO/ASI/Upturn set unless they are truly the best fit.',
    '2b) Project stacks (R19/R8/R14/R18): keep original stacks by default. ONLY change stacks for skills that are unmatched vs the JD, and ONLY in at most 2 projects. Leave the other 3 projects unchanged. Keep project names/URLs unchanged. If replacing with C++, C++ must be the SOLE backend on those 2 projects — never C++ with Node/Python/Java/Go. Never write C++20/C++23.',
    '2c) If this JD is about AI, agents, LLM, Co-Pilot, prompt engineering, machine learning, or data science: INCLUDE AWS AI Summer Camp in Featured Projects AND still keep ≥3 LINKED projects.',
    '3) Experience (R21): MINIMUM 3 and MAXIMUM 4 bullets/job; may mention JD skills with evidence.',
    '4) Projects (R22): MINIMUM 3 and MAXIMUM 4 bullets/project. Education minimal (R5). Exactly content for 2 pages (R2/R11).',
    '5) Cover EVERY required/preferred JD skill (R1: 100%) in Skills AND an evidenced bullet. Prefer truthful mapping (R9).',
    '',
    'AFTER the LaTeX body, you MUST append this exact match report (not optional):',
    '===MATCH_REPORT===',
    '{"jdSkills":["every important tech/skill from the JD"],"matched":["skills present with evidence on the resume"],"missing":["JD skills not on the resume"],"skillGaps":["short notes e.g. C# listed but no .NET project bullet"],"keywordMatchScore":0,"resumeMatchScore":0,"notes":"1 short factual sentence on keyword coverage only — NO career advice"}',
    '===END_MATCH_REPORT===',
    'Scores 0-100. keywordMatchScore = % of jdSkills that are matched. resumeMatchScore = overall fit (keywords + evidence quality). Be honest — do not claim 100 if any jdSkill is missing or only stuffed in Languages without evidence. Target EXACTLY 100. notes MUST be ≤1 sentence and MUST NOT include application advice, track recommendations, or "want me to fix" offers.',
    '',
    '=== JOB DESCRIPTION ===',
    cleaned,
  ].join('\n');
}

export interface PasteResumeContext {
  resumeText: string;
  jobDescription?: string;
  title?: string;
  company?: string;
  jobType?: JobType;
}

/** Convert a pasted resume (any portal/format) into amazon.pdf LaTeX. */
export function buildPasteToLatexSystemPrompt(ctx: PasteResumeContext): string {
  const instructions = loadInstructionsText();
  const template = readAsset('amazonResumeTemplate.tex');
  const profileCatalog = readAsset('profileCatalog.txt');
  const baseResume = readAsset('baseResume-v10.txt');

  const gradRule =
    ctx.jobType === 'internship'
      ? 'INTERNSHIP — MS graduation date: January 2028.'
      : ctx.jobType === 'fulltime'
        ? 'FULL-TIME — MS graduation date: May 2027.'
        : 'Prefer internship (Jan 2028) unless JD clearly says full-time (May 2027).';

  return [
    'You convert a pasted resume into amazon.pdf-style LaTeX for Amreen Kousar.',
    '=== MASTER RULEBOOK ===',
    instructions.slice(0, 12000),
    '',
    gradRule,
    ctx.title ? `Target role: ${ctx.title}` : '',
    ctx.company ? `Target company: ${ctx.company}` : '',
    '',
    '=== STRUCTURE TEMPLATE (amazon.pdf) ===',
    'Keep section order and \\textbar design. Name is ALWAYS Amreen Kousar.',
    'Output body starting at \\section{\\textbf{Education}} through Certifications (no preamble/header).',
    template.slice(0, 8000),
    '',
    '=== VERIFIED FACTS (never invent beyond paste + these) ===',
    baseResume.slice(0, 6000),
    profileCatalog.slice(0, 5000),
    '',
    'Use the PASTED resume as the primary content source. Map roles/projects/skills into amazon sections.',
    'If a JD is also provided, reorder skills and rewrite bullets to match it (Rule 1/19).',
    '3–4 bullets/job (min 3), 3–4 bullets/project (min 3), top 5 from FULL ~23-project pool (≥3 LINKED), exactly 2 pages worth of content.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildPasteToLatexUserPrompt(ctx: PasteResumeContext): string {
  const resume = ctx.resumeText.trim();
  if (resume.length < 80) throw new Error('Pasted resume is too short.');

  const jd = ctx.jobDescription ? cleanJobDescriptionForResume(ctx.jobDescription) : '';
  const parts = [
    'Convert the PASTED RESUME below into amazon.pdf LaTeX.',
    'CRITICAL OUTPUT FORMAT:',
    '- Start EXACTLY at: \\section{\\textbf{Education}}',
    '- Then Technical Skills, Professional Experience (ASI Web Developer first if present), Featured Projects, Publications, Certifications.',
    '- Do NOT output \\documentclass / packages / centered header.',
    '- Candidate name is ALWAYS Amreen Kousar.',
    '- Keep real company names, dates, project URLs from the paste when present.',
    '- Do not invent employers, metrics, or URLs that are not in the paste or verified profile.',
    '',
    '=== PASTED RESUME (source) ===',
    resume.slice(0, 20000),
  ];

  if (jd) {
    const keywords = extractJdKeywords(jd);
    parts.push(
      '',
      '=== OPTIONAL JOB DESCRIPTION (tailor to this) ===',
      jd.slice(0, 8000),
      keywords.length ? `JD KEYWORDS TO COVER: ${keywords.join(', ')}` : ''
    );
  }

  return parts.filter(Boolean).join('\n');
}
