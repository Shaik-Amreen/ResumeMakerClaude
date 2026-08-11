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
import { isInternshipTitle } from './eligibility';
import { sendEmailNotification } from './notifier';
import type { JobType } from '../models/Job';
import { makeTraceId, traceError, traceLog } from './debugTrace';
import { isPipelineAbortError, throwIfAborted } from './pipelineAbort';

const MAX_PAGE_REPAIRS = 2;
const MIN_LINKED_PROJECTS = 3;

/** Returns elapsed time string like "1m 23s" or "4.2s" */
function elapsed(startMs: number): string {
  const sec = (Date.now() - startMs) / 1000;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${sec.toFixed(1)}s`;
}

type ResumeCtx = {
  jobDescription: string;
  title?: string;
  company?: string;
  jobType?: JobType;
  traceId?: string;
  abortSignal?: AbortSignal;
};

export type RunResumePipelineOptions = {
  signal?: AbortSignal;
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
      '- Cap each job at 3–4 complete bullets (110–130 plain chars, filling 90%–100% of line width).',
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
    throwIfAborted(ctx.abortSignal);
    const compileStart = Date.now();
    try {
      const compiled = compileWithJdHeader(latex, jobId, ctx);
      pdfPath = compiled.pdfPath;
      pageCount = compiled.pageCount;
      latex = compiled.latex;
      console.log(`  ⏱️ Compile attempt ${attempt + 1}: ${elapsed(compileStart)} → ${pageCount} page(s)`);
    } catch (compileErr) {
      const detail = compileErr instanceof Error ? compileErr.message : 'PDF compile failed';
      console.log(`  ⏱️ Compile attempt ${attempt + 1}: FAILED after ${elapsed(compileStart)}`);
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
      const repairStart = Date.now();
      latex = enforceMasterRules(
        await reviseResumeLatex(
          ctx,
          latex,
          `LaTeX failed to compile. Output Work Experience → Certifications only. Fix for EXACTLY 1 page matching amazonResumeTemplate.tex.\n${detail.slice(0, 800)}`
        )
      );
      console.log(`  ⏱️ Compile-repair revision ${attempt + 1}: ${elapsed(repairStart)}`);
      continue;
    }

    if (pageCount === 1) break;

    if (attempt >= MAX_PAGE_REPAIRS) {
      return { latex, pdfPath, pageCount };
    }

    await onNote?.(
      `Got ${pageCount} page(s) — auto-trimming to exactly 1 page (attempt ${attempt + 1}/${MAX_PAGE_REPAIRS})…`
    );
    const repairStart = Date.now();
    latex = enforceMasterRules(
      await reviseResumeLatex(ctx, latex, pageRepairInstruction(pageCount))
    );
    console.log(`  ⏱️ Page-repair revision ${attempt + 1}: ${elapsed(repairStart)}`);
  }

  return { latex, pdfPath, pageCount };
}

export async function runResumePipeline(
  jobId: string,
  traceId = makeTraceId('resume'),
  options?: RunResumePipelineOptions
) {
  throwIfAborted(options?.signal);
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  traceLog(traceId, 'pipeline.loaded', {
    jobId,
    title: job.title,
    company: job.company,
    status: job.status,
    resumePhase: job.resumePhase,
  });

  const agentLabel = resumeAgentLabel();
  if (String(job.jobType) === 'internship' || isInternshipTitle(job.title)) {
    traceLog(traceId, 'pipeline.skip-internship', { title: job.title, jobType: job.jobType });
    job.status = 'invalid_job';
    job.resumePhase = 'failed';
    job.pendingAction = null;
    job.errorMessage = 'Internship skipped — full-time / new-grad only.';
    job.approvalNote = 'Skipped internship. This tracker only generates resumes for full-time roles.';
    await job.save();
    return;
  }

  if (String(job.jobDescription || '').trim().length < 80) {
    traceLog(traceId, 'pipeline.skip-short-jd', { jdLen: String(job.jobDescription || '').length });
    job.status = 'failed';
    job.resumePhase = 'failed';
    job.pendingAction = null;
    job.errorMessage = 'Job description too short or empty — cannot tailor a resume.';
    job.approvalNote = 'Skipped: JD missing/too short. Refresh the listing or paste a full JD, then Generate.';
    await job.save();
    return;
  }

  const ctx: ResumeCtx = {
    jobDescription: job.jobDescription,
    title: job.title,
    company: job.company,
    jobType: 'fulltime',
    traceId,
    abortSignal: options?.signal,
  };

  try {
    throwIfAborted(options?.signal);
    traceLog(traceId, 'pipeline.start', { provider: agentLabel });
    job.status = 'resume_generating';
    job.resumePhase = 'generating';
    job.pendingAction = null;
    job.errorMessage = undefined;
    job.matchScore = undefined;
    job.keywordMatchScore = undefined;
    job.matchedKeywords = undefined;
    job.missingKeywords = undefined;
    job.skillGaps = undefined;
    const pipelineStart = Date.now();
    const genStart = Date.now();
    job.approvalNote = `Tailoring resume…`;
    await job.save();

    console.log(`\n📄 Resume agent started: ${job.title} @ ${job.company} (Provider: ${agentLabel})`);

    traceLog(traceId, 'pipeline.generate.start');
    throwIfAborted(options?.signal);
    const generated = await generateResumeLatex(ctx);
    const activeProvider = generated.usedProvider || agentLabel;
    traceLog(traceId, 'pipeline.generate.done', {
      provider: activeProvider,
      latexChars: generated.latex.length,
      elapsed: elapsed(genStart),
      hasLlmMatch: Boolean(generated.llmMatch),
    });
    console.log(`  ⏱️ [${elapsed(pipelineStart)}] LaTeX generation: ${elapsed(genStart)} (${generated.latex.length} chars via ${activeProvider})`);

    let latex = applyJdHeaderTagline(enforceMasterRules(generated.latex), {
      title: ctx.title,
      jobDescription: ctx.jobDescription,
      company: ctx.company,
    });

    job.resumePhase = 'compiling';
    job.approvalNote = `[${elapsed(pipelineStart)}] Generated via ${activeProvider} · Compiling LaTeX → PDF (1-page fit)…`;
    await job.save();
    traceLog(traceId, 'pipeline.compile.start');
    throwIfAborted(options?.signal);

    const fitStart = Date.now();
    let fitted = await compileAndFitOnePage(ctx, latex, job.id, async (note) => {
      job.resumePhase = 'compiling';
      job.approvalNote = `[${elapsed(pipelineStart)}] ${note}`;
      await job.save();
      traceLog(traceId, 'pipeline.compile.note', { note });
    });
    traceLog(traceId, 'pipeline.compile.done', {
      elapsed: elapsed(fitStart),
      pageCount: fitted.pageCount,
      pdfPath: fitted.pdfPath,
    });
    console.log(`  ⏱️ [${elapsed(pipelineStart)}] Compile+fit total: ${elapsed(fitStart)}`);

    latex = fitted.latex;
    job.latexResume = latex;
    job.pdfPath = fitted.pdfPath;
    await job.save();

    if (fitted.pageCount !== 1) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = `PDF is ${fitted.pageCount} page(s): must be exactly 1 after auto-repair.`;
      job.approvalNote = `[${elapsed(pipelineStart)}] Resume (${activeProvider}) is ${fitted.pageCount} page(s) after auto-repair. Trim content, then click Recompile PDF.`;
      await job.save();
      traceLog(traceId, 'pipeline.page-count-failed', { pageCount: fitted.pageCount });
      console.log(`  ⏱️ [${elapsed(pipelineStart)}] Pipeline total (page-count fail): ${elapsed(pipelineStart)}`);
      return;
    }

    job.resumePhase = 'checking_match';
    job.approvalNote = `[${elapsed(pipelineStart)}] Calculating match score for ${activeProvider}…`;
    await job.save();
    traceLog(traceId, 'pipeline.match.start');

    const regexMatch = scoreResumeAgainstJd(job.jobDescription, latex);
    const { match, skillGaps, resumeMatchScore } = mergeLlmAndRegexMatch(
      generated.llmMatch,
      regexMatch
    );
    applyMatchFieldsToJob(job, match, { skillGaps, resumeMatchScore });
    job.latexResume = latex;
    job.pdfPath = fitted.pdfPath;
    job.approvalNote = `Tailored via ${activeProvider} · Keyword match ${match.score}% · resume match ${resumeMatchScore}%${
      match.missing.length ? ` · missing: ${match.missing.slice(0, 6).join(', ')}` : ''
    }`;
    await job.save();
    traceLog(traceId, 'pipeline.match.done', {
      keywordMatchScore: match.score,
      resumeMatchScore,
      missingCount: match.missing.length,
    });

    if (fitted.pageCount !== 1) {
      job.status = 'resume_generated';
      job.resumePhase = 'failed';
      job.pendingAction = 'resume_review';
      job.errorMessage = `PDF is ${fitted.pageCount} page(s): must be exactly 1.`;
      job.approvalNote = `Stopped with ${fitted.pageCount} page(s). No match-repair retries.`;
      await job.save();
      traceLog(traceId, 'pipeline.page-count-failed-post-match', { pageCount: fitted.pageCount });
      console.log(`  ⏱️ Pipeline total (page-count fail): ${elapsed(pipelineStart)}`);
      return;
    }

    assertExactlyOnePage(fitted.pdfPath);
    traceLog(traceId, 'pipeline.assert-one-page.done');

    const fullMatch = isFullJdMatch(match);
    const linkedOk = hasEnoughLinkedProjects(latex, MIN_LINKED_PROJECTS);
    const linked = countLinkedFeaturedProjects(latex);

    job.status = 'pending_resume_approval';
    job.resumePhase = 'done';
    job.pendingAction = 'resume_review';
    job.errorMessage = undefined;
    applyMatchFieldsToJob(job, match, { skillGaps, resumeMatchScore });

    if (!fullMatch || !linkedOk) {
      job.approvalNote = !fullMatch
        ? `1-page PDF ready • JD match ${match.score}% (resume match ${resumeMatchScore}%). Missing: ${match.missing.slice(0, 6).join(', ') || 'none'}. Review PDF in preview.`
        : `1-page PDF ready • ${linked}/${MIN_LINKED_PROJECTS} linked featured projects. Review PDF in preview.`;
    } else {
      job.approvalNote =
        job.priority === 'faang'
          ? `🚨 FAANG/MANGO • 1 page (template lock), 100% JD keywords · resume ${resumeMatchScore}%. Apply manually on company site.`
          : `1 page • 100% keyword match · resume ${resumeMatchScore}%. Review PDF, then Approve or Approve & Auto-Apply.`;
    }
    await job.save();
    traceLog(traceId, 'pipeline.save.done', {
      status: job.status,
      resumePhase: job.resumePhase,
      totalElapsed: elapsed(pipelineStart),
    });

    traceLog(traceId, 'pipeline.email.start');
    await sendEmailNotification(
      `📄 Resume ready (1 page, ${match.score}% keywords / resume ${resumeMatchScore}%)\n${job.title} @ ${job.company}\n${
        job.priority === 'faang' ? '🚨 FAANG/MANGO • Apply manually, no auto-apply.\n' : ''
      }Review PDF in job tracker.`
    ).catch(() => undefined); // don't let email failure block the pipeline
    traceLog(traceId, 'pipeline.email.done');
    console.log(
      `✅ Resume pipeline complete: ${job.title} (1 page, ${match.score}% keywords, resume ${resumeMatchScore}%) — total ${elapsed(pipelineStart)}`
    );
    traceLog(traceId, 'pipeline.complete', { totalElapsed: elapsed(pipelineStart) });
  } catch (err) {
    if (isPipelineAbortError(err)) {
      job.status = 'scraped';
      job.resumePhase = undefined;
      job.pendingAction = null;
      job.errorMessage = undefined;
      job.approvalNote = 'Generation cancelled — ready to retry.';
      await job.save();
      traceLog(traceId, 'pipeline.aborted', { reason: err.message });
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Resume generation failed';
    job.status = 'failed';
    job.resumePhase = 'failed';
    job.errorMessage = message;
    job.pendingAction = null;
    job.approvalNote = undefined;
    await job.save();
    console.error('Resume pipeline error:', err);
    traceError(traceId, 'pipeline.failed', err);
    throw err;
  }
}

/** @deprecated Use runResumePipeline */
export const runOllamaResumePipeline = runResumePipeline;
