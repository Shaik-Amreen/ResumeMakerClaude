import path from 'path';
import { By, type Locator, WebElement } from 'selenium-webdriver';
import Job, { type IJob } from '../models/Job';
import { config } from '../config';
import { applicationProfile, type ApplicationProfile } from '../data/applicationProfile';
import { waitForApproval } from './pipelineService';
import { sendEmailNotification } from './notifier';
import { shouldSkipJobDescription } from './jobSkipRules';
import {
  closeApplicationAiSession,
  createApplicationAiAnswerer,
} from './claudeService';

export interface FormQuestionContext {
  workLocation: string;
  jobDescription: string;
  profile: ApplicationProfile;
  useAi: boolean;
  aiAnswer?: (
    label: string,
    type: 'text' | 'textarea',
    jobDescription: string
  ) => Promise<string | null>;
}

export function buildApplyProfile(): ApplicationProfile {
  return {
    ...applicationProfile,
    overwritePreviousAnswers: config.apply.overwritePreviousAnswers,
  };
}

export async function runPreApplySkipCheck(job: IJob): Promise<void> {
  if (job.priority === 'faang') {
    job.status = 'failed';
    job.errorMessage = 'FAANG/MANGO — never auto-applied. Apply yourself on the company site.';
    job.pendingAction = null;
    await job.save();
    throw new Error(job.errorMessage);
  }

  const skipCheck = shouldSkipJobDescription(job.title, job.company, job.jobDescription);
  if (skipCheck.skip) {
    job.status = 'failed';
    job.errorMessage = `Skipped before apply: ${skipCheck.reason}`;
    job.pendingAction = null;
    await job.save();
    throw new Error(job.errorMessage);
  }
}

export async function createApplyAiAnswerer(profile: ApplicationProfile) {
  if (!config.apply.useAiForQuestions) return null;
  return createApplicationAiAnswerer(profile.userInformationAll);
}

export function buildFormContext(
  job: IJob,
  profile: ApplicationProfile,
  aiAnswerer: FormQuestionContext['aiAnswer']
): FormQuestionContext {
  return {
    workLocation: job.location || profile.currentCity || 'United States',
    jobDescription: job.jobDescription,
    profile,
    useAi: config.apply.useAiForQuestions,
    aiAnswer: aiAnswerer ?? undefined,
  };
}

export async function uploadPdfToVisibleInputs(
  root: WebElement | { findElements: (locator: Locator) => Promise<WebElement[]> },
  pdfPath: string,
  locator: Locator
) {
  const fileInputs = await root.findElements(locator);
  for (const input of fileInputs) {
    try {
      await input.sendKeys(path.resolve(pdfPath));
    } catch {
      // some file inputs are hidden
    }
  }
}

/** Always pause for your approval before the final submit click. */
export async function requestSubmitApproval(job: IJob, jobId: string, platformLabel: string) {
  job.status = 'pending_submit_approval';
  job.pendingAction = 'submit_application';
  job.approvalNote = `Final step on ${platformLabel} — approve to submit the application.`;
  await job.save();

  await sendEmailNotification(
    `🚀 Approve application submit (${platformLabel})\n${job.title} @ ${job.company}\nReview the form in Chrome, then approve in the job tracker.`
  );

  const approved = await waitForApproval(jobId, 'submit_application');
  if (!approved || approved.status === 'failed') {
    throw new Error('Submit approval cancelled or timed out.');
  }
}

export async function markApplySuccess(job: IJob, platformLabel: string) {
  job.status = 'applied';
  job.pendingAction = null;
  job.approvalNote = `Application submitted successfully via ${platformLabel}.`;
  job.errorMessage = undefined;
  await job.save();
  await sendEmailNotification(`✅ Applied via ${platformLabel}!\n${job.title} @ ${job.company}`);
}

export async function markApplyFailed(job: IJob, err: unknown, platformLabel: string) {
  const message = err instanceof Error ? err.message : 'Auto-apply failed';
  job.status = 'failed';
  job.errorMessage = message;
  job.pendingAction = null;
  await job.save();
  console.error(`${platformLabel} apply error:`, err);
  await sendEmailNotification(`❌ Apply failed (${platformLabel})\n${job.title} @ ${job.company}\n${message}`);
}

export async function cleanupApplySession() {
  await closeApplicationAiSession();
}
