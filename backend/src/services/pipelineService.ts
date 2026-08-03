import Job, { IJob, PendingAction } from '../models/Job';
import { config } from '../config';
import { generateResumeWithChatGPT, readLatexFromOpenChatGPT } from './chatgptService';
import { evaluateWithClaude, runClaudeStepOnly } from './claudeService';
import { releaseDriver } from './chromeProfile';
import { WebDriver } from 'selenium-webdriver';
import { sendEmailNotification } from './notifier';
import { sanitizeResumeLatex } from './resumeAgent/sanitizeLatex';

export async function waitForApproval(
  jobId: string,
  expectedAction: PendingAction,
  timeoutMs = config.approval.timeoutMs
): Promise<IJob | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await Job.findById(jobId);
    if (!job) return null;
    if (job.pendingAction !== expectedAction) {
      return job;
    }
    await new Promise((r) => setTimeout(r, config.approval.pollIntervalMs));
  }
  throw new Error(`Timed out waiting for approval: ${expectedAction}`);
}

export async function runResumePipeline(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');

  let driver: WebDriver | null = null;
  try {
    job.status = 'resume_generating';
    job.pendingAction = null;
    job.errorMessage = undefined;
    await job.save();

    const chatgpt = await generateResumeWithChatGPT(job.jobDescription);
    driver = chatgpt.driver;
    job.latexResume = sanitizeResumeLatex(chatgpt.latex);
    await job.save();

    const evaluation = await evaluateWithClaude(driver, job.latexResume, job.jobDescription);

    await applyClaudeEvaluation(job, evaluation, job.latexResume);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resume pipeline failed';
    job.status = 'failed';
    job.errorMessage = message;
    job.pendingAction = null;
    await job.save();
    console.error('Resume pipeline error:', err);
  } finally {
    await releaseDriver(driver);
  }
}

async function applyClaudeEvaluation(
  job: IJob,
  evaluation: { isMatch: boolean; latex?: string },
  fallbackLatex: string
) {
  job.latexResume = sanitizeResumeLatex(evaluation.latex || fallbackLatex);

  if (evaluation.isMatch) {
    job.status = 'pending_resume_approval';
    job.pendingAction = 'resume_review';
    job.matchScore = 100;
    job.approvalNote = '100% match confirmed. Upload your approved PDF.';
    await job.save();

    await sendEmailNotification(
      `100% match — resume ready\n${job.title} @ ${job.company}\nUpload PDF in job tracker when ready.`
    );
    console.log(`✅ 100% match: ${job.title} @ ${job.company}`);
    return;
  }

  job.status = 'resume_generated';
  job.pendingAction = 'resume_review';
  job.matchScore = 0;
  job.approvalNote = 'Not 100% match yet — review LaTeX in job tracker.';
  await job.save();
  console.log(`Not 100% match: ${job.title} @ ${job.company}`);
}

/** Skip ChatGPT — rerun Claude only using saved LaTeX + JD. */
export async function runClaudeOnlyPipeline(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');

  let latex = job.latexResume?.trim();
  if (!latex) {
    const fromTab = await readLatexFromOpenChatGPT();
    if (fromTab) {
      latex = sanitizeResumeLatex(fromTab);
      job.latexResume = latex;
      await job.save();
      console.log(`Saved LaTeX from ChatGPT tab for ${job.company}`);
    }
  }

  if (latex) latex = sanitizeResumeLatex(latex);

  if (!latex) {
    throw new Error('No LaTeX saved — run ChatGPT step first or keep ChatGPT tab open.');
  }

  try {
    job.status = 'resume_generating';
    job.pendingAction = null;
    job.errorMessage = undefined;
    await job.save();

    console.log(`Claude-only rerun: ${job.title} @ ${job.company}`);
    const evaluation = await runClaudeStepOnly(latex, job.jobDescription);
    await applyClaudeEvaluation(job, evaluation, latex);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Claude step failed';
    job.status = 'failed';
    job.errorMessage = message;
    job.pendingAction = null;
    await job.save();
    console.error('Claude-only pipeline error:', err);
  }
}
