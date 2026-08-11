import Job from '../models/Job';
import {
  compileLatexToPdf,
  assertExactlyTwoPages,
  isSecondPageSparse,
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
const MAX_DENSITY_REPAIRS = 2;
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
  // Returned latex is what was compiled — ensure header tagline stuck
  return {
    ...compiled,
    latex: applyJdHeaderTagline(compiled.latex, header),
  };
}

function pageRepairInstruction(pageCount: number): string {
  if (pageCount > 2) {
    return [
      `COMPILED PDF HAS ${pageCount} PAGES — it MUST be EXACTLY 2 pages.`,
      'Output ONLY sections from \\section{\\textbf{Education}} onward (no preamble).',
      'Shorten: remove weakest project, cut bullets to 1 line, tighten skills.',
      'Keep ASI Web Developer first. Name is Amreen Kousar (header locked).',
    ].join(' ');
  }
  if (pageCount > 0 && pageCount < 2) {
    return [
      `COMPILED PDF HAS ONLY ${pageCount} PAGE — it MUST be EXACTLY 2 FULL pages.`,
      'Output ONLY sections from \\section{\\textbf{Education}} onward (no preamble).',
      'Expand projects/experience with metrics so both pages are full.',
    ].join(' ');
  }
  return [
    'PDF page count invalid. Regenerate amazon.pdf section body only (Education → Certifications).',
    'No \\documentclass. No fontspec. Candidate Amreen Kousar only.',
  ].join(' ');
}

function sparsePage2RepairInstruction(): string {
  return [
    'PAGE 2 IS TOO EMPTY (large white gap; only pubs/certs or a thin slice of content).',
    'Both pages must look FULL and balanced.',
    'Fix by: (1) moving 1-2 projects so they start on page 2, OR (2) adding another catalog project with 3-4 strong bullets on page 2, OR (3) expanding experience/project bullets so content fills most of page 2 above Certifications.',
    'Keep EXACTLY 2 pages total (do not become 3). Keep 100% JD keyword coverage and amazon.pdf \\textbar design.',
    'Output complete LaTeX only.',
  ].join(' ');
}

async function compileAndFitTwoFullPages(
  ctx: ResumeCtx,
  latexIn: string,
  jobId: string,
  onNote?: (note: string) => Promise<void>
): Promise<{ latex: string; pdfPath: string; pageCount: number; sparse: boolean }> {
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
      // Weak local models often emit uncompilable LaTeX — lock to amazon template instead of looping.
      if (attempt === 0) {
        await onNote?.(
          `Compile failed — locking amazon.pdf 2-page template (attempt ${attempt + 1}/${MAX_PAGE_REPAIRS})…`
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
          `LaTeX failed to compile. Output ONLY sections from \\section{\\textbf{Education}} onward (no preamble). Fix errors for EXACTLY 2 FULL pages.\n${detail.slice(0, 800)}`
        )
      );
      continue;
    }

    if (pageCount === 2) break;

    if (attempt >= MAX_PAGE_REPAIRS) {
      return { latex, pdfPath, pageCount, sparse: false };
    }

    await onNote?.(
      `Got ${pageCount} page(s) — auto-repairing to exactly 2 full pages (attempt ${attempt + 1}/${MAX_PAGE_REPAIRS})…`
    );
    latex = enforceMasterRules(
      await reviseResumeLatex(ctx, latex, pageRepairInstruction(pageCount))
    );
  }

  for (let d = 0; d < MAX_DENSITY_REPAIRS && pageCount === 2 && isSecondPageSparse(pdfPath, latex); d++) {
    console.warn(`⚠️ Page 2 looks sparse — densifying (attempt ${d + 1}/${MAX_DENSITY_REPAIRS})…`);
    await onNote?.(
      `Page 2 has a large empty gap — densifying content (attempt ${d + 1}/${MAX_DENSITY_REPAIRS})…`
    );
    latex = enforceMasterRules(
      await reviseResumeLatex(ctx, latex, sparsePage2RepairInstruction())
    );

    try {
      const compiled = compileWithJdHeader(latex, jobId, ctx);
      pdfPath = compiled.pdfPath;
      pageCount = compiled.pageCount;
      latex = compiled.latex;
    } catch {
      break;
    }

    if (pageCount > 2) {
      latex = enforceMasterRules(
        await reviseResumeLatex(ctx, latex, pageRepairInstruction(pageCount))
      );
      try {
        const compiled = compileWithJdHeader(latex, jobId, ctx);
        pdfPath = compiled.pdfPath;
        pageCount = compiled.pageCount;
        latex = compiled.latex;
      } catch {
        break;
      }
    }
  }

  const sparse = pageCount === 2 && isSecondPageSparse(pdfPath, latex);
  return { latex, pdfPath, pageCount, sparse };
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
    job.approvalNote = `Generating tailored 2-page resume with ${agentLabel}…`;
    await job.save();

    console.log(`\n📄 Resume agent: ${job.title} @ ${job.company}`);

    const generated = await generateResumeLatex(ctx);
    let latex = applyJdHeaderTagline(enforceMasterRules(generated.latex), {
      title: ctx.title,
      jobDescription: ctx.jobDescription,
      company: ctx.company,
    });

    job.resumePhase = 'compiling';
    job.approvalNote = 'Compiling LaTeX → PDF and fitting to exactly 2 pages…';
    await job.save();

    let fitted = await compileAndFitTwoFullPages(ctx, latex, job.id, async (note) => {
      job.resumePhase = 'compiling';
      job.approvalNote = note;
      await job.save();
    });
    latex = fitted.latex;
    job.latexResume = latex;
    job.pdfPath = fitted.pdfPath;
    await job.save();

    if (fitted.pageCount !== 2) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = `PDF is ${fitted.pageCount} page(s) — must be exactly 2 after auto-repair.`;
      job.approvalNote = `Resume is ${fitted.pageCount} page(s) after auto-repair. Trim/expand manually, then Build PDF.`;
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

    // One-shot only: never re-generate / repair when match is under 100%.
    if (fitted.pageCount !== 2) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = `PDF is ${fitted.pageCount} page(s) — must be exactly 2.`;
      job.approvalNote = `Stopped with ${fitted.pageCount} page(s). No match-repair retries.`;
      await job.save();
      return;
    }

    if (fitted.sparse) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage =
        'PDF is 2 pages but page 2 is too empty (large gap). Needs denser projects/experience on page 2.';
      job.approvalNote =
        '2 pages but page 2 still has a large empty gap. Regenerate or edit LaTeX to fill page 2.';
      await job.save();
      console.warn(`⚠️ ${job.title}: 2 pages but sparse page 2`);
      return;
    }

    assertExactlyTwoPages(fitted.pdfPath);

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
        ? `🚨 FAANG/MANGO — 2 full pages, 100% JD keywords · resume ${resumeMatchScore}%. Apply yourself (no auto-apply).`
        : job.jobType === 'internship'
          ? `2 full pages — 100% keyword match · resume ${resumeMatchScore}%. Review PDF, then apply manually on the company site.`
          : `2 full pages — 100% keyword match · resume ${resumeMatchScore}%. Review PDF, then Approve or Approve & Auto-Apply.`;
    await job.save();

    await sendEmailNotification(
      `📄 Resume ready (2 full pages, 100% keywords / resume ${resumeMatchScore}%)\n${job.title} @ ${job.company}\n${
        job.priority === 'faang' ? '🚨 FAANG/MANGO — apply yourself, no auto-apply.\n' : ''
      }Review PDF in job tracker.`
    );
    console.log(
      `✅ Resume pipeline complete: ${job.title} (2 full pages, 100% keywords, resume ${resumeMatchScore}%)`
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
