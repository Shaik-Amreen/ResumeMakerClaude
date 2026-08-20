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
  traceId?: string;
  abortSignal?: AbortSignal;
}

export function buildResumeSystemPrompt(ctx: ResumeJobContext): string {
  const instructions = loadInstructionsText();
  const chatRulesFile = readAsset('ollamaChatRules.txt');
  const chatRulesDb = loadOllamaChatRules();
  const template = readAsset('amazonResumeTemplate.tex');
  const baseResume = readAsset('baseResume-v10.txt');
  const profileCatalog = readAsset('profileCatalog.txt');
  const projectPool = readAsset('projectPool.txt');
  // Full career KB is large — include identity/eligibility + experience/project headers for grounding.
  const careerKb = readAsset('Karthik_COMPLETE_CAREER_KNOWLEDGE_BASE.md').slice(0, 14000);

  const gradRule =
    'FULL-TIME / NEW-GRAD only — MS graduation date: January 2027. Never tailor for internships.';

  const roleContext = [
    ctx.title && `Target role: ${ctx.title}`,
    ctx.company && `Target company: ${ctx.company}`,
    gradRule,
    'Candidate: future visa sponsorship = Yes (H-1B); now = No while OPT-eligible; ambiguous “require sponsorship?” = Yes; now-or-future = Yes. Skip JDs that refuse sponsorship.',
    'Do NOT fabricate (even in CloudSync/RenderSync): Kubernetes/production K8s, Kafka/production Kafka, Terraform, Go/Golang (ban entirely), Rust, C++, .NET, Azure, GCP, Spark/Hadoop, TF/PyTorch/production ML training, MLOps, Blockchain/Web3, Salesforce, SAP, Rails, native Swift/Kotlin, security clearance, Docker, microservices, GraphQL — Skills OK only if already supported by real experience/template; never invent project bullets for these.',
    'Prefer evidence order: Java, AWS, Python, React, Node.js, Spring Boot, REST APIs, TypeScript/JavaScript, CI/CD, PostgreSQL/MySQL/MongoDB/Redis.',
    'Amazon bullets: only LinkedIn-public facts; do not invent confidential internal details.',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    '=== MASTER RULEBOOK (ALL 22 RULES — OBEY LITERALLY EVERY TIME) ===',
    'You MUST follow Rules 1–22 in instructions.txt exactly. No career advice. No commentary essays. Output LaTeX (+ MATCH_REPORT) only.',
    'Violations that are FORBIDDEN: JD prose in Languages/Skills; inventing fake employers or employment dates/locations; inventing schools; fabricating more than 2 projects; dropping sections.',
    instructions,
    '',
    '=== COMPACT RULE REMINDER ===',
    chatRulesFile,
    chatRulesDb,
    '',
    roleContext,
    '',
    '=== CRITICAL: DESIGN LOCK = amazonResumeTemplate.tex ===',
    'LOOK must be identical to the Overleaf template: same bold map, \\vspace{2pt} gaps, itemize options, \\uline companies, \\textbar.',
    'CONTENT only is tailored per JD (bullets, Skills tokens, project pick/stacks). NEVER change spacing/margins/bold scheme.',
    'You MUST rewrite Skills, experience bullets, and project stacks for THIS JD.',
    'BOLD: job title, \\uline{\\textbf{company}}, dates, tech+metrics in bullets, skill labels, \\href{\\textbf{project}}.',
    'NOT bold: header role {Software Engineer}, project stack after \\textbar {React, ...}.',
    'Header MUST be EXACTLY 3 lines: Line 1 Name | Line 2 Title + Open to Relocate + Email + Phone + Location | Line 3 LinkedIn + Portfolio + GitHub.',
    'Title = Software Engineer / Backend Engineer / Frontend Engineer / Full Stack Engineer (never full JD title).',
    'Prune low-priority details on overflow: drop Open to Relocate first, California, USA second, karthikkovi.com third.',
    'After every \\section{\\textbf{...}}: \\vspace{2pt}. Between Key Projects: \\vspace{2pt}.',
    'Experience itemize: [itemsep=2pt, topsep=2pt, parsep=0pt, partopsep=0pt, leftmargin=10pt] (never bare itemize).',
    'EACH \\item = ONE complete printed line (target 80–95 plain chars, hard max 95). Ends with period — never mid-phrase cut, never an orphan word wrapped to a second line.',
    'FILL THE PAGE FULLY: The resume MUST span 100% of the page height without leaving empty white space at the bottom. Use 4 rich bullets for Amazon, 4 for ASI, 4 for Infobell, and 4–5 detailed Key Projects to ensure a dense, highly professional, recruiter-ready 1-page layout.',
    'VOICE: human template style (built/wrote/shipped/used…). NO AI traces (leveraged/utilized/spearheaded/cutting-edge/seamless/…).',
    'ADAPTABLE & EVIDENCE (RULE 1): Required JD skills you CAN evidence (Java/AWS/Python/React/Node/Spring/REST/TS/JS/CI-CD/DBs/OS/architecture/networking when coursework-backed) MUST appear in Experience or ≤2 Key Project bullets — Skills-only does not count for those.',
    'DO-NOT-FABRICATE TECH (see FABRICATION_POLICY.md): Kubernetes/production K8s, Kafka/production Kafka, Terraform, Go (ban entirely), Rust, C++, .NET, Azure, GCP, Spark/Hadoop, TF/PyTorch/production ML training, MLOps, Blockchain, Salesforce, SAP, Rails, native Swift/Kotlin, security clearance, Docker, microservices, GraphQL — Skills line only if already supported; NEVER invent Experience/Project production bullets for these.',
    'VERIFIED EVIDENCE: Forecasting → Amazon AI assistant skill; OS/Architecture/Networking → CloudSync/RenderSync (within 2-project cap); Java/AWS/Python/React/Node/Spring/REST/SQL/CI/CD → Amazon/ASI/Infobell + projects when already true.',
    'SAME-CONCEPT SWAP OK for allowed stack (Postgres↔MySQL, Express↔Fastify). Do not swap banned tech into fabricated project stacks. Never invent Go.',
    'FABRICATION POLICY: NEVER invent employers/titles/dates/schools/contact/URLs. Headers LOCKED: Amazon Intern 05/2026-08/2026 Bellevue; ASI 02/2025-Present; Infobell 01/2023-01/2025.',
    'OPEN: Skills (allowed tech); Certs; ≤2 projects (CloudSync + RenderSync) — except do-not-fabricate list.',
    'Employers ONLY: Amazon → ASI → Infobell.',
    'Copying the template skills/projects unchanged is a FAILURE only when they miss allowed JD-required skills.',
    '',
    '=== AMAZON.PDF LaTeX TEMPLATE (STRUCTURE + VISUAL LOCK — layout is mandatory) ===',
    'Keep section order and \\textbar design. ALWAYS keep Amazon Software Engineer Intern first under Work Experience (then ASI, then Infobell).',
    'Section order: Work Experience → Skills → Key Projects → Education → Certifications.',
    'Skills categories exact: Languages / Backend / Frontend / Cloud \\& DevOps / Monitoring / Practices.',
    'Key Projects: \\href{url}{\\textbf{Name - Tagline}} \\,\\textbar\\, {stack}\\\\ then one evidence sentence; \\vspace{2pt} between projects.',
    'Rule 7: pick top projects from the FULL project pool below — NOT the template default set blindly.',
    'One frontend + one backend per project (Rules 8/14/18). NEVER mix C++ with Node/Python/Java/Go. Write "C++" only — never C++20/C++23. You may invent features/metrics within existing projects.',
    'Rule 19: change project stacks ONLY for unmatched JD skills, and ONLY in 2 projects max.',
    'Rule 1: EXACTLY 100% JD keyword coverage with evidenced bullets (not ~95%).',
    'AI / agents / LLM JDs: MUST include Booking Bee and/or Instant Backend Generator while keeping ≥3 LINKED projects.',
    'Date ranges/titles/certs use plain " - " (spaces both sides). NEVER LaTeX -- / --- or Unicode en/em dashes.',
    '',
    template,
    '',
    '=== PROJECT POOL (Rule 7 — pick top projects from HERE; ≥3 LINKED) ===',
    projectPool,
    '',
    '=== BASE RESUME TRUTH SOURCE (candidate facts; do not invent beyond this) ===',
    baseResume.slice(0, 4000),
    '',
    'FINAL CHECKLIST (Rules 1-22 — ALL REQUIRED):',
    '□ R1: every JD tech skill evidenced in a bullet (100%, not skills-list only)',
    '□ R2/R11: amazon Times LaTeX; VISUAL LOCK; EXACTLY 1 PAGE (never 2) — trim content, never change gaps',
    '□ R3: header EXACTLY 3 lines (Name / Title+Contact / Links); prune low-priority details (Relocate, Location, Portfolio) on overflow',
    '□ R4: Work Experience → Skills → Key Projects → Education → Certifications; each section + \\vspace{2pt}',
    '□ R5: Education LOCKED — CSULB + JNTU only. Experience headers LOCKED — Amazon 05/2026-08/2026 Bellevue; ASI 02/2025-Present; Infobell 01/2023-01/2025. NEVER invent schools/employers/dates.',
    '□ R6: plain " - " hyphens with spaces both sides; never -- / --- / en/em dashes; no mid-phrase bullet cuts',
    '□ R7: top 4–5 from FULL project pool; ≥3 LINKED live URLs when possible; \\vspace{2pt} between projects',
    '□ R8/R14/R18: one frontend + one backend; never mix competing frontends; C++ sole backend if used',
    '□ R9/R15: fabricate features/metrics on at most 2 projects (prefer CloudSync + RenderSync); never invent employers; no GitHub project links',
    '□ R10/R16: certs as Name - Year \\\\ (open to add/adjust for JD)',
    '□ R12/R19: change at most 2 project stacks for unmatched JD skills (CloudSync/RenderSync preferred)',
    '□ R13: co-founder ONLY if JD asks',
    '□ R17: workflow complete; R20 short title; R21 3–5 complete lines/job (headers LOCKED; bullets may rewrite)',
    '□ Bold tech+metrics in bullets; skill labels bold; stacks after \\textbar NOT bold',
    '□ Human voice / no AI traces (no leveraged/spearheaded/cutting-edge/seamless/meta-LLM talk)',
    '□ R23/R24: full JD coverage via Skills + ≤2 projects + real employer bullets; never fake employers',
    '□ Languages = programming languages ONLY — never JD sentences',
    '□ Amazon → ASI → Infobell only; NEVER Redbee; Karthik Kovi; match amazonResumeTemplate.tex layout',
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
    '- Start EXACTLY at: \\section{\\textbf{Work Experience}}',
    '- Then: Work Experience (Amazon Intern first, then ASI; bullets rewritten), Skills (REWRITTEN for JD), Key Projects, Education, Certifications.',
    '- End before \\end{document}. Do NOT output \\documentclass/packages/header — pipeline locks Karthik Kovi header.',
    '- Candidate name is ALWAYS Karthik Kovi.',
    '- NEVER copy HTML tags, &nbsp;, section headers like "Knowledge Skills Abilities", or raw JD sentences into Skills.',
    '- Languages line = programming languages ONLY (Python, Java, C++, …). NEVER paste JD phrases like "Build production systems" or "What You\'ll Bring".',
    '- Skills lines must be clean comma-separated technologies only (e.g. Java, C#, .NET, React, Docker).',
    '- Do NOT write career-advice essays, "overqualified" commentary, or soft-skill lectures in MATCH_REPORT notes.',
    keywordLine,
    'REWRITE RULES FOR THIS JD (tied to Master Rules):',
    '1) Skills (R1/R19): reorder to put required JD skills first. Do not invent unrelated stacks. Languages = languages only.',
    '2) Key Projects (R7): Rank ALL projects in the PROJECT POOL. Pick the TOP 4–5 for THIS JD. At least 3 MUST use real LINKED URLs from the pool when possible.',
    '2b) Project stacks (R19): keep original stacks by default. ONLY change stacks for skills that are unmatched vs the JD, and ONLY in at most 2 projects.',
    '2c) AI / agents / LLM JDs: MUST INCLUDE Booking Bee and/or Instant Backend Generator when relevant, while keeping ≥3 LINKED projects.',
    '3) Experience (R21): KEEP locked headers (Amazon Intern 05/2026-08/2026 Bellevue; ASI 02/2025-Present; Infobell 01/2023-01/2025). Rewrite 3–5 bullets only — never invent employers/dates (no Advanced Systems Inc, no Jan 2024 Amazon).',
    '3b) Voice: match amazonResumeTemplate.tex (built/wrote/shipped/used…). Ban AI filler (leveraged/spearheaded/cutting-edge/seamless/…).',
    '3c) Fabrication: Skills + Certs + ≤2 projects (prefer CloudSync/RenderSync). No fake Experience employers.',
    '4) Education LOCKED to template: California State University, Long Beach + JNTU Anantapur - MITS only. NEVER invent San Jose State or any other school. EXACTLY 1 page (never 2) — trim projects/bullets to fit.',
    '5) Cover EVERY required/preferred JD skill (R1: 100%). Prefer Skills + ≤2 fabricatable projects + real employer bullet emphasis.',
    '6) VISUAL LOCK + EXACTLY 1 PAGE: amazonResumeTemplate.tex bold/gaps; 3-line header; auto-prune low priority details on overflow.',
    '7) itemize MUST include [itemsep=2pt, topsep=2pt, parsep=0pt, partopsep=0pt, leftmargin=10pt]; bold tech+metrics in bullets.',
    '8) If content would spill to page 2: drop weakest projects (keep ≥3 LINKED), cut to 3–4 complete bullets/job — rewrite, do not truncate mid-line.',
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

  const careerKb = readAsset('Karthik_COMPLETE_CAREER_KNOWLEDGE_BASE.md').slice(0, 10000);
  const gradRule =
    'FULL-TIME / NEW-GRAD only — MS graduation date: January 2027. Never tailor for internships.';

  return [
    'You convert a pasted resume into amazon.pdf-style LaTeX for Karthik Kovi using his standard template.',
    '=== MASTER RULEBOOK ===',
    instructions.slice(0, 12000),
    '',
    gradRule,
    ctx.title ? `Target role: ${ctx.title}` : '',
    ctx.company ? `Target company: ${ctx.company}` : '',
    '',
    '=== STRUCTURE TEMPLATE (amazon.pdf) ===',
    'Keep section order and \\textbar design. Name is ALWAYS Karthik Kovi.',
    'Section order: Work Experience → Skills → Key Projects → Education → Certifications.',
    'Output body starting at \\section{\\textbf{Work Experience}} through Certifications (no preamble/header).',
    template.slice(0, 8000),
    '',
    '=== VERIFIED FACTS (never invent beyond paste + these) ===',
    baseResume.slice(0, 6000),
    profileCatalog.slice(0, 5000),
    careerKb,
    '',
    'Use the PASTED resume as the primary content source. Map roles/projects/skills into amazon sections.',
    'If a JD is also provided, reorder skills and rewrite bullets to match it (Rule 1/19).',
    '3–5 bullets/job, Key Projects from pool (4–5 max, ≥3 LINKED), EXACTLY 1 page; 3-line header (prune low-priority details on overflow).',
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
    '- Start EXACTLY at: \\section{\\textbf{Work Experience}}',
    '- Then Technical Skills, Work Experience (Amazon Intern first, then ASI), Skills, Key Projects, Education, Certifications.',
    '- Do NOT output \\documentclass / packages / centered header.',
    '- Candidate name is ALWAYS Karthik Kovi.',
    '- Keep real company names, dates, project URLs from the paste when present.',
    '- You may fabricate and invent relevant project features or scaling metrics within the existing projects to match the JD. Do not invent fake employers.',
    '- SYSTEMS: Operating Systems / Computer Architecture / Networking may be fabricated into CloudSync, RenderSync, MirrorMate, or SystemsLab (B.Tech coursework — user authorized).',
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
