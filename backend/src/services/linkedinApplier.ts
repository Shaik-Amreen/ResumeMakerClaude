import { By, WebDriver, WebElement } from 'selenium-webdriver';
import Job from '../models/Job';
import { config } from '../config';
import { attachDriver, releaseDriver } from './chromeProfile';
import { syncOrangeSession } from './cookieSync';
import { sendEmailNotification } from './notifier';
import { waitForApproval } from './pipelineService';
import {
  answerEasyApplyQuestions,
  findEasyApplyModal,
} from './easyApplyQuestions';
import { shouldSkipCompanyAbout } from './jobSkipRules';
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

async function draftRecruiterMessage(jobTitle: string, company: string): Promise<string> {
  return `Hi — I just applied for the ${jobTitle} role at ${company}. I would love to connect and share why I am excited about the team.`;
}

async function trySendLinkedInMessage(driver: WebDriver, message: string) {
  const messageButtons = await driver.findElements(
    By.xpath("//button[contains(., 'Message')] | //a[contains(., 'Message')]")
  );
  if (!messageButtons.length) return false;

  await messageButtons[0].click();
  await driver.sleep(2000);

  for (const selector of [
    'div.msg-form__contenteditable',
    'div[contenteditable="true"][role="textbox"]',
    '.compose-form__message-field',
  ]) {
    try {
      const box = await driver.findElement(By.css(selector));
      await box.click();
      await box.sendKeys(message);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function tryReadCompanyAbout(driver: WebDriver): Promise<string> {
  try {
    const about = await driver.findElement(By.css('.jobs-company__box'));
    await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', about);
    return (await about.getText()).trim();
  } catch {
    return '';
  }
}

async function clickEasyApplyNextOrReview(modal: WebElement) {
  const reviewButtons = await modal.findElements(
    By.xpath('.//button[contains(., "Review")] | .//span[normalize-space(.)="Review"]/ancestor::button')
  );
  if (reviewButtons.length) {
    await reviewButtons[0].click();
    return 'review';
  }

  const nextButtons = await modal.findElements(
    By.xpath('.//button[contains(., "Next")] | .//span[normalize-space(.)="Next"]/ancestor::button')
  );
  if (nextButtons.length) {
    await nextButtons[0].click();
    return 'next';
  }
  return null;
}

/** LinkedIn Easy Apply — internships and full-time. Submit always requires your approval. */
export async function applyLinkedInJob(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (!job.pdfPath) throw new Error('Upload an approved PDF before applying.');

  await runPreApplySkipCheck(job);

  let driver: WebDriver | null = null;
  const profile = buildApplyProfile();
  let aiAnswerer: Awaited<ReturnType<typeof createApplyAiAnswerer>> = null;

  try {
    job.status = 'applying';
    job.pendingAction = null;
    job.errorMessage = undefined;
    await job.save();

    aiAnswerer = await createApplyAiAnswerer(profile);
    const ctx = buildFormContext(job, profile, aiAnswerer ?? undefined);

    driver = await attachDriver(orangeProfile(job.url));
    await syncOrangeSession(driver, job.url);
    await driver.sleep(3000);

    const aboutText = await tryReadCompanyAbout(driver);
    if (aboutText) {
      const aboutSkip = shouldSkipCompanyAbout(aboutText);
      if (aboutSkip.skip) throw new Error(`Skipped: ${aboutSkip.reason}`);
    }

    const draft = await draftRecruiterMessage(job.title, job.company);
    job.recruiterMessageDraft = draft;
    job.status = 'pending_message_approval';
    job.pendingAction = 'message_send';
    job.approvalNote = 'Review the LinkedIn message before it is sent.';
    await job.save();

    await sendEmailNotification(
      `💬 Approve LinkedIn message\n${job.title} @ ${job.company}\nOpen job tracker to approve the recruiter message.`
    );

    const afterMessageApproval = await waitForApproval(jobId, 'message_send');
    if (!afterMessageApproval || afterMessageApproval.status === 'failed') {
      throw new Error('Message approval cancelled or timed out.');
    }

    await trySendLinkedInMessage(driver, afterMessageApproval.recruiterMessageDraft || draft);

    const easyApply = await driver.findElements(
      By.xpath("//button[contains(@class, 'jobs-apply-button') and contains(., 'Easy Apply')]")
    );
    if (!easyApply.length) {
      throw new Error('Easy Apply button not found. Manual application may be required.');
    }
    await easyApply[0].click();
    await driver.sleep(2000);

    let step = 0;
    while (step < 15) {
      step += 1;
      await driver.sleep(1500);

      const modal = await findEasyApplyModal(driver);
      if (!modal) throw new Error('Easy Apply modal not found.');

      await answerEasyApplyQuestions(driver, modal, ctx);
      await uploadPdfToVisibleInputs(modal, job.pdfPath, By.css('input[type="file"]'));

      const submitButtons = await modal.findElements(
        By.xpath('.//button[contains(., "Submit application")]')
      );

      if (submitButtons.length) {
        await requestSubmitApproval(job, jobId, 'LinkedIn');
        await submitButtons[0].click();
        await markApplySuccess(job, 'LinkedIn');
        return;
      }

      const action = await clickEasyApplyNextOrReview(modal);
      if (!action) throw new Error('Unknown application step — manual input may be required.');
    }

    throw new Error('Application flow exceeded step limit.');
  } catch (err) {
    await markApplyFailed(job, err, 'LinkedIn');
  } finally {
    await cleanupApplySession();
    await releaseDriver(driver);
  }
}

// Backward-compatible export
export const autoApplyToJob = applyLinkedInJob;
