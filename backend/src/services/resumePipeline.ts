import Job from '../models/Job';
import {
  compileLatexToPdf,
  assertExactlyOnePage,
} from './latexCompileService';
import {
  generateResumeLatex,
  reviseResumeLatex,
  resumeAgentLabel,
} from './resumeAgent';
import { enforceMasterRules } from './resumeAgent/enforceMasterRules';
import {
  isFullJdMatch,
  scoreResumeAgainstJd,
  applyMatchFieldsToJob,
  mergeLlmAndRegexMatch,
  hasEnoughLinkedProjects,
  countLinkedFeaturedProjects,
} from './resumeAgent/jdMatch';
import { getAmazonTemplateLatex, applyJdHeaderTagline } from './resumeAgent/amazonLatexGuard';
import { sendEmailNotification } from './notifier';
import type { JobType } from '../models/Job';

const MAX_PAGE_REPAIRS = 4;
const MIN_LINKED_PROJECTS = 3;

type ResumeCtx = {
  jobDescription: string;
  title?: string;
  company?: string;
  jobType?: JobType;
};

function compileWithJdHeader(latex: string, jobId: string, ctx: ResumeCtx) {
  const header = {
    title: ctx.title,
    jobDescription: ctx.jobDescription,
    company: ctx.company,
  };
  const compiled = compileLatexToPdf(latex, jobId, { header });
  return {
    ...compiled,
    latex: applyJdHeaderTagline(compiled.latex, header),
  };
}

function pageRepairInstruction(pageCount: number): string {
  if (pageCount > 1) {
    return [
      `COMPILED PDF HAS ${pageCount} PAGES — it MUST be EXACTLY 1 page (match amazonResumeTemplate.tex).`,
      'Output ONLY sections from \\section{\\textbf{Work Experience}} through Certifications (no preamble).',
      'TRIM hard without changing margins/itemsep/titlespacing/bold scheme:',
      '- Drop weakest Key Projects until ≤4 remain (≥3 LINKED).',
      '- Cap each job at 3–4 ONE-LINE bullets (≤95 plain chars).',
      '- Shorten Skills lines; remove filler words from bullets.',
      'Keep Amazon → ASI → Infobell. Name Karthik Kovi (header locked). Visual lock unchanged.',
    ].join(' ');
  }
  if (pageCount === 0) {
    return [
      'Page counter returned 0 (often a false alarm). Still output a complete 1-page resume.',
      'Output FULL body from \\section{\\textbf{Work Experience}} through Certifications (no preamble).',
      'Keep amazonResumeTemplate.tex visual lock. Amazon → ASI → Infobell. EXACTLY 1 page.',
    ].join(' ');
  }
  return [
    'PDF page count invalid. Regenerate body from Work Experience → Certifications.',
    'EXACTLY 1 page. Match template layout. No \\documentclass. Karthik Kovi only.',
  ].join(' ');
}

async function compileAndFitOnePage(
  ctx: ResumeCtx,
  latexIn: string,
  jobId: string,
  onNote?: (note: string) => Promise<void>
): Promise<{ latex: string; pdfPath: string; pageCount: number }> {
  let latex = latexIn;
  let pdfPath = '';
  let pageCount = 0;

  for (let attempt = 0; attempt <= MAX_PAGE_REPAIRS; attempt++) {
    try {
      const compiled = compileWithJdHeader(latex, jobId, ctx);
      pdfPath = compiled.pdfPath;
      pageCount = compiled.pageCount;
      latex = compiled.latex;
    } catch (compileErr) {
      const detail = compileErr instanceof Error ? compileErr.message : 'PDF compile failed';
      if (attempt >= MAX_PAGE_REPAIRS) throw compileErr;
      if (attempt === 0) {
        await onNote?.(
          `Compile failed — locking 1-page template (attempt ${attempt + 1}/${MAX_PAGE_REPAIRS})…`
        );
        latex = getAmazonTemplateLatex();
        continue;
      }
      await onNote?.(
        `Compile failed — repairing LaTeX (attempt ${attempt + 1}/${MAX_PAGE_REPAIRS})…`
      );
      latex = enforceMasterRules(
        await reviseResumeLatex(
          ctx,
          latex,
          `LaTeX failed to compile. Output Work Experience → Certifications only. Fix for EXACTLY 1 page matching amazonResumeTemplate.tex.\n${detail.slice(0, 800)}`
        )
      );
      continue;
    }

    if (pageCount === 1) break;

    if (attempt >= MAX_PAGE_REPAIRS) {
      return { latex, pdfPath, pageCount };
    }

    await onNote?.(
      `Got ${pageCount} page(s) — auto-trimming to exactly 1 page (attempt ${attempt + 1}/${MAX_PAGE_REPAIRS})…`
    );
    latex = enforceMasterRules(
      await reviseResumeLatex(ctx, latex, pageRepairInstruction(pageCount))
    );
  }

  return { latex, pdfPath, pageCount };
}

export async function runResumePipeline(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');

  const agentLabel = resumeAgentLabel();
  const ctx: ResumeCtx = {
    jobDescription: job.jobDescription,
    title: job.title,
    company: job.company,
    jobType: job.jobType,
  };

  try {
    job.status = 'resume_generating';
    job.resumePhase = 'generating';
    job.pendingAction = null;
    job.errorMessage = undefined;
    job.matchScore = undefined;
    job.keywordMatchScore = undefined;
    job.matchedKeywords = undefined;
    job.missingKeywords = undefined;
    job.skillGaps = undefined;
    job.approvalNote = `Generating tailored 1-page resume with ${agentLabel}…`;
    await job.save();

    console.log(`\n📄 Resume agent: ${job.title} @ ${job.company}`);

    const generated = await generateResumeLatex(ctx);
    let latex = applyJdHeaderTagline(enforceMasterRules(generated.latex), {
      title: ctx.title,
      jobDescription: ctx.jobDescription,
      company: ctx.company,
    });

    job.resumePhase = 'compiling';
    job.approvalNote = 'Compiling LaTeX → PDF and fitting to exactly 1 page…';
    await job.save();

    let fitted = await compileAndFitOnePage(ctx, latex, job.id, async (note) => {
      job.resumePhase = 'compiling';
      job.approvalNote = note;
      await job.save();
    });
    latex = fitted.latex;
    job.latexResume = latex;
    job.pdfPath = fitted.pdfPath;
    await job.save();

    if (fitted.pageCount !== 1) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = `PDF is ${fitted.pageCount} page(s) — must be exactly 1 after auto-repair.`;
      job.approvalNote = `Resume is ${fitted.pageCount} page(s) after auto-repair. Trim content to match the 1-page template, then Build PDF.`;
      await job.save();
      return;
    }

    job.resumePhase = 'checking_match';
    job.approvalNote = 'Checking keyword match & resume match against the JD…';
    await job.save();

    const regexMatch = scoreResumeAgainstJd(job.jobDescription, latex);
    const { match, skillGaps, resumeMatchScore } = mergeLlmAndRegexMatch(
      generated.llmMatch,
      regexMatch
    );
    applyMatchFieldsToJob(job, match, { skillGaps, resumeMatchScore });
    job.latexResume = latex;
    job.pdfPath = fitted.pdfPath;
    job.approvalNote = `Keyword match ${match.score}% · resume match ${resumeMatchScore}%${
      match.missing.length ? ` — missing: ${match.missing.slice(0, 6).join(', ')}` : ''
    }`;
    await job.save();

    if (fitted.pageCount !== 1) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = `PDF is ${fitted.pageCount} page(s) — must be exactly 1.`;
      job.approvalNote = `Stopped with ${fitted.pageCount} page(s). No match-repair retries.`;
      await job.save();
      return;
    }

    assertExactlyOnePage(fitted.pdfPath);

    const fullMatch = isFullJdMatch(match);
    const linkedOk = hasEnoughLinkedProjects(latex, MIN_LINKED_PROJECTS);
    if (!fullMatch || !linkedOk) {
      const linked = countLinkedFeaturedProjects(latex);
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = !fullMatch
        ? `JD match ${match.score}% (missing: ${match.missing.slice(0, 12).join(', ')}). Not 100% — no auto-retry.`
        : `Only ${linked} linked Featured Project(s) — need ≥${MIN_LINKED_PROJECTS} with live URLs. No auto-retry.`;
      job.approvalNote = !fullMatch
        ? `Stopped at ${match.score}% (need 100%). Missing: ${match.missing.slice(0, 8).join(', ') || '—'}. See skill gaps — regenerate manually if you want another attempt.`
        : `Stopped — only ${linked}/${MIN_LINKED_PROJECTS} linked projects. No auto-retry.`;
      await job.save();
      console.warn(
        `⚠️ ${job.title}: stopping without retry — ${!fullMatch ? `JD match ${match.score}%` : `linked projects ${linked}`}`
      );
      return;
    }

    job.status = 'pending_resume_approval';
    job.resumePhase = 'done';
    job.pendingAction = 'resume_review';
    job.errorMessage = undefined;
    applyMatchFieldsToJob(job, match, { skillGaps, resumeMatchScore });
    job.approvalNote =
      job.priority === 'faang'
        ? `🚨 FAANG/MANGO — 1 page (template lock), 100% JD keywords · resume ${resumeMatchScore}%. Apply yourself (no auto-apply).`
        : job.jobType === 'internship'
          ? `1 page — 100% keyword match · resume ${resumeMatchScore}%. Review PDF, then apply manually on the company site.`
          : `1 page — 100% keyword match · resume ${resumeMatchScore}%. Review PDF, then Approve or Approve & Auto-Apply.`;
    await job.save();

    await sendEmailNotification(
      `📄 Resume ready (1 page, 100% keywords / resume ${resumeMatchScore}%)\n${job.title} @ ${job.company}\n${
        job.priority === 'faang' ? '🚨 FAANG/MANGO — apply yourself, no auto-apply.\n' : ''
      }Review PDF in job tracker.`
    );
    console.log(
      `✅ Resume pipeline complete: ${job.title} (1 page, 100% keywords, resume ${resumeMatchScore}%)`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resume generation failed';
    job.status = 'failed';
    job.resumePhase = 'failed';
    job.errorMessage = message;
    job.pendingAction = null;
    job.approvalNote = undefined;
    await job.save();
    console.error('Resume pipeline error:', err);
    throw err;
  }
}

/** @deprecated Use runResumePipeline */
export const runOllamaResumePipeline = runResumePipeline;
