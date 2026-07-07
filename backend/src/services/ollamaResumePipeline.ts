import Job from '../models/Job';
import { releaseDriver } from './chromeProfile';
import { compileLatexToPdf } from './latexCompileService';
import { generateResumeWithOllama } from './ollamaService';
import { sendEmailNotification } from './notifier';
import type { WebDriver } from 'selenium-webdriver';

export async function runOllamaResumePipeline(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');

  let driver: WebDriver | null = null;

  try {
    job.status = 'resume_generating';
    job.pendingAction = null;
    job.errorMessage = undefined;
    job.approvalNote = 'Generating resume with Ollama (Selenium + local Ollama API)…';
    await job.save();

    console.log(`\n🦙 Ollama resume: ${job.title} @ ${job.company}`);

    const { latex, driver: ollamaDriver } = await generateResumeWithOllama(job.jobDescription);
    driver = ollamaDriver;
    job.latexResume = latex;
    await job.save();

    try {
      const { pdfPath } = compileLatexToPdf(latex, job.id);
      job.pdfPath = pdfPath;
      job.status = 'pending_resume_approval';
      job.pendingAction = 'resume_review';
      job.approvalNote =
        'Ollama resume ready — review PDF preview, then Approve or Approve & Auto-Apply (full-time).';
      job.errorMessage = undefined;
      await job.save();

      await sendEmailNotification(
        `🦙 Ollama resume ready\n${job.title} @ ${job.company}\nReview PDF in job tracker.`
      );
      console.log(`✅ Ollama pipeline complete: ${job.title}`);
    } catch (compileErr) {
      job.status = 'resume_generated';
      job.pendingAction = 'resume_review';
      job.approvalNote = 'LaTeX from Ollama saved — PDF compile failed. Paste/fix LaTeX or install BasicTeX.';
      job.errorMessage =
        compileErr instanceof Error ? compileErr.message : 'PDF compile failed';
      await job.save();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ollama resume generation failed';
    job.status = 'failed';
    job.errorMessage = message;
    job.pendingAction = null;
    job.approvalNote = undefined;
    await job.save();
    console.error('Ollama resume pipeline error:', err);
    throw err;
  } finally {
    await releaseDriver(driver);
  }
}
