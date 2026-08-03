import { By, WebDriver } from 'selenium-webdriver';
import Job from '../models/Job';
import { config } from '../config';
import { attachDriver, releaseDriver } from './chromeProfile';
import { syncOrangeSession } from './cookieSync';
import {
  buildApplyProfile,
  buildFormContext,
  cleanupApplySession,
  createApplyAiAnswerer,
  markApplyFailed,
  markApplySuccess,
  requestSubmitApproval,
  runPreApplySkipCheck,
  uploadPdfToVisibleInputs,
} from './applyHelpers';
import {
  clickApplyEntryPoint,
  fillGenericFormFields,
  findNextButton,
  findSubmitButton,
} from './genericFormQuestions';

function orangeProfile(startUrl: string) {
  const { linkedin } = config;
  return {
    kind: 'orange' as const,
    userDataDir: linkedin.userDataDir,
    profileDirectory: linkedin.profileDirectory,
    debugPort: linkedin.debugPort,
    headless: linkedin.headless,
    startUrl,
  };
}

function platformLabel(source?: string, url?: string): string {
  if (source === 'indeed' || url?.includes('indeed.com')) return 'Indeed';
  if (source === 'jobright' || url?.includes('jobright.ai')) return 'Jobright';
  if (source === 'greenhouse' || url?.includes('greenhouse.io')) return 'Greenhouse';
  if (source === 'lever' || url?.includes('lever.co')) return 'Lever';
  if (source === 'career_portal') return 'Google';
  return source || 'External site';
}

/** Auto-apply for Indeed, Jobright, Google Jobs, and other non-LinkedIn-Easy-Apply URLs. */
export async function applyExternalJob(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (!job.pdfPath) throw new Error('Upload an approved PDF before applying.');

  await runPreApplySkipCheck(job);

  const label = platformLabel(job.source, job.url);
  let driver: WebDriver | null = null;
  const profile = buildApplyProfile();
  let aiAnswerer: Awaited<ReturnType<typeof createApplyAiAnswerer>> = null;

  try {
    job.status = 'applying';
    job.pendingAction = null;
    job.errorMessage = undefined;
    job.approvalNote = `Opening ${label} application…`;
    await job.save();

    aiAnswerer = await createApplyAiAnswerer(profile);
    const ctx = buildFormContext(job, profile, aiAnswerer ?? undefined);

    driver = await attachDriver(orangeProfile(job.url));
    await syncOrangeSession(driver, job.url);
    await driver.sleep(3000);

    const clickedApply = await clickApplyEntryPoint(driver);
    if (!clickedApply) {
      console.log(`${label}: no Apply button found — filling form on current page.`);
    }

    let step = 0;
    while (step < 15) {
      step += 1;
      await driver.sleep(1500);

      await fillGenericFormFields(driver, driver, ctx);
      await uploadPdfToVisibleInputs(driver, job.pdfPath, By.css('input[type="file"]'));

      const submitBtn = await findSubmitButton(driver);
      if (submitBtn) {
        await requestSubmitApproval(job, jobId, label);
        await submitBtn.click();
        await markApplySuccess(job, label);
        return;
      }

      const nextBtn = await findNextButton(driver);
      if (nextBtn) {
        await nextBtn.click();
        continue;
      }

      if (step >= 3) {
        throw new Error(
          `${label}: could not find Next or Submit — review the form manually in Chrome.`
        );
      }
    }

    throw new Error(`${label}: application flow exceeded step limit.`);
  } catch (err) {
    await markApplyFailed(job, err, label);
  } finally {
    await cleanupApplySession();
    await releaseDriver(driver);
  }
}
