import { By, WebDriver, WebElement } from 'selenium-webdriver';
import Job, { type IJob } from '../models/Job';
import { config } from '../config';
import { attachDriver, releaseDriver } from './chromeProfile';
import { syncOrangeSession } from './cookieSync';
import { detectAts, type AtsType } from './atsDetector';
import {
  GREENHOUSE_IFRAME_SELECTORS,
  classifyPageBlocker,
  looksLikeSuccessPage,
  resolveLeverApplyUrl,
} from './careerApplyUtils';
import {
  fillAtsFormFields,
  readVisiblePageText,
  uploadResumeOnly,
} from './careerAtsAdapters';
import {
  isJobrightUrl,
  isExternalCareerUrl,
  normalizeCareerApplyUrl,
  resolveJobrightCareerUrl,
  sanitizeStoredJobUrl,
} from './jobrightApplyLink';
import {
  buildApplyProfile,
  buildFormContext,
  cleanupApplySession,
  markApplyConfusedHold,
  markApplyFailed,
  markApplySuccess,
  requestSubmitApproval,
  runPreApplySkipCheck,
  setApplyPhase,
} from './applyHelpers';
import {
  askApplyManager,
  captureApplyPageSnapshot,
  heuristicApplyAction,
} from './applyManager';
import { executeApplyManagerAction } from './applyManagerExecutor';
import {
  clickApplyEntryPoint,
  findNextButton,
  findSubmitButton,
} from './genericFormQuestions';
import { tryPortalAccountAuth } from './portalAccountAuth';

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

/** True when Chrome is already on the same job/ATS destination we intend to open. */
function sameJobDestination(currentUrl: string, targetUrl: string): boolean {
  try {
    if (!currentUrl || /about:blank/i.test(currentUrl)) return false;
    const cur = new URL(currentUrl);
    const tgt = new URL(targetUrl);
    if (cur.hostname.toLowerCase() !== tgt.hostname.toLowerCase()) return false;
    // Workday apply/login/createAccount under same site + same job id is fine
    const jobId =
      tgt.pathname.match(/_R\d+/i)?.[0] ||
      tgt.searchParams.get('R_ID') ||
      tgt.pathname.replace(/XMLNAME-/gi, '');
    if (jobId && cur.href.includes(jobId.replace(/^_/, ''))) return true;
    const a = cur.pathname.replace(/\/+$/, '').replace(/XMLNAME-/gi, '').toLowerCase();
    const b = tgt.pathname.replace(/\/+$/, '').replace(/XMLNAME-/gi, '').toLowerCase();
    return a === b || a.startsWith(b) || b.startsWith(a);
  } catch {
    return false;
  }
}


async function clickFirstVisible(
  driver: WebDriver,
  xpaths: string[]
): Promise<boolean> {
  for (const xpath of xpaths) {
    const els = await driver.findElements(By.xpath(xpath));
    for (const el of els) {
      try {
        if (await el.isDisplayed() && await el.isEnabled()) {
          await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', el);
          try {
            await el.click();
          } catch {
            await driver.executeScript('arguments[0].click();', el);
          }
          await driver.sleep(1500);
          return true;
        }
      } catch {
        // try next
      }
    }
  }
  return false;
}

export async function switchIntoGreenhouseFrame(driver: WebDriver): Promise<boolean> {
  await driver.switchTo().defaultContent();
  for (const selector of GREENHOUSE_IFRAME_SELECTORS) {
    try {
      const frames = await driver.findElements(By.css(selector));
      for (const frame of frames) {
        try {
          await driver.switchTo().frame(frame);
          const inputs = await driver.findElements(
            By.css('input, textarea, select, button[type="submit"]')
          );
          if (inputs.length > 0) return true;
          await driver.switchTo().defaultContent();
        } catch {
          await driver.switchTo().defaultContent();
        }
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

async function enterGreenhouseApply(driver: WebDriver): Promise<void> {
  const url = await driver.getCurrentUrl();
  if (!/#app/i.test(url) && !/job_app/i.test(url)) {
    try {
      await driver.executeScript('window.location.hash = "app";');
      await driver.sleep(1200);
    } catch {
      // ignore
    }
  }

  await clickFirstVisible(driver, [
    '//button[contains(translate(., "APPLY", "apply"), "apply") and not(contains(translate(., "APPLIED", "applied"), "applied"))]',
    '//a[contains(translate(., "APPLY", "apply"), "apply")]',
    '//*[@id="apply_button"]',
    '//button[@aria-label="Apply"]',
    '//button[contains(@class, "btn--pill") and contains(., "Apply")]',
    '//button[contains(@class, "btn--rounded") and contains(., "Apply")]',
  ]);

  if (await switchIntoGreenhouseFrame(driver)) return;

  try {
    const app = await driver.findElement(
      By.css(
        '#first_name, #application, #apply_form, .application--container, form#application_form, form[action*="greenhouse"], input#resume'
      )
    );
    await driver.executeScript('arguments[0].scrollIntoView({block:"start"});', app);
  } catch {
    // form may already be visible
  }
}

async function enterLeverApply(driver: WebDriver, jobUrl: string): Promise<void> {
  const applyUrl = resolveLeverApplyUrl(jobUrl);
  const current = await driver.getCurrentUrl();
  if (applyUrl && applyUrl !== current && !/\/apply(\/|$|\?)/i.test(current)) {
    await driver.get(applyUrl);
    await driver.sleep(2000);
  }

  await clickFirstVisible(driver, [
    '//a[contains(@class, "postings-btn") and contains(translate(., "APPLY", "apply"), "apply")]',
    '//a[contains(translate(., "APPLY", "apply"), "apply for this job")]',
    '//button[contains(@class, "template-btn-submit")]',
    '//button[contains(translate(., "APPLY", "apply"), "apply")]',
    '//a[contains(@href, "/apply")]',
  ]);

  try {
    const form = await driver.findElement(
      By.css('#application-form, .application-form, form[action*="lever"], .main-form')
    );
    await driver.executeScript('arguments[0].scrollIntoView({block:"start"});', form);
  } catch {
    // form may already be on page
  }
}

async function enterAshbyApply(driver: WebDriver): Promise<void> {
  await clickFirstVisible(driver, [
    '//button[contains(translate(., "APPLY", "apply"), "apply")]',
    '//a[contains(translate(., "APPLY", "apply"), "apply")]',
  ]);
  await driver.sleep(1500);
}

async function enterWorkdayApply(driver: WebDriver): Promise<void> {
  await clickFirstVisible(driver, [
    '//*[@data-automation-id="adventureButton"]',
    '//*[@data-automation-id="applyButton"]',
    '//button[@data-automation-id="apply"]',
    '//button[contains(translate(., "APPLY", "apply"), "apply")]',
    '//a[contains(translate(., "APPLY", "apply"), "apply")]',
    '//button[contains(., "Start")]',
  ]);
}

async function enterAtsApplyMode(
  driver: WebDriver,
  ats: AtsType,
  jobUrl: string
): Promise<void> {
  switch (ats) {
    case 'greenhouse':
      await enterGreenhouseApply(driver);
      break;
    case 'lever':
      await enterLeverApply(driver, jobUrl);
      break;
    case 'ashby':
      await enterAshbyApply(driver);
      break;
    case 'workday':
      await enterWorkdayApply(driver);
      break;
    default: {
      const before = (await driver.getCurrentUrl()).split('#')[0];
      const clicked = await clickApplyEntryPoint(driver);
      if (!clicked) {
        console.log('Career apply: no Apply entry point — filling form on current page.');
      } else {
        await driver.sleep(1500);
        // Paychex: prefer the form-submit Apply Now if we stayed on the JD page
        const after = (await driver.getCurrentUrl()).split('#')[0];
        if (/maininforeq\\.asp/i.test(after) || after === before) {
          const forced = (await driver.executeScript(`
            const links = Array.from(document.querySelectorAll('a'));
            const formApply = links.find((a) =>
              /^apply now$/i.test((a.innerText || '').trim()) &&
              /javascript:\\s*document\\.ThisForm\\.submit/i.test(a.getAttribute('href') || '')
            );
            if (formApply) { formApply.click(); return true; }
            return false;
          `)) as boolean;
          if (forced) {
            console.log('Career apply: forced Paychex ThisForm.submit Apply Now');
            await driver.sleep(3000);
          }
        }
      }
    }
  }
}

async function repairAppOneBioFields(
  driver: WebDriver,
  profile: ReturnType<typeof buildApplyProfile>
): Promise<void> {
  const url = await driver.getCurrentUrl();
  if (!/bioinfo\.asp/i.test(url)) return;

  const digits = profile.phone.replace(/\D/g, '');
  const ten =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
  const phoneDashed =
    ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : profile.phone;

  await driver.executeScript(
    `
    function setNative(el, val) {
      if (!el) return;
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const phone = arguments[0];
    const first = arguments[1];
    const last = arguments[2];
    const city = arguments[3];
    const zip = arguments[4];
    const email = arguments[5];
    setNative(document.querySelector('input[name="Phone"]'), phone);
    setNative(document.querySelector('input[name="AltPhone"]'), phone);
    setNative(document.querySelector('input[name="First"]'), first);
    setNative(document.querySelector('input[name="Last"]'), last);
    setNative(document.querySelector('input[name="Middle"]'), '');
    setNative(document.querySelector('input[name="Suffix"]'), '');
    setNative(document.querySelector('input[name="City"]'), city);
    setNative(document.querySelector('input[name="Zip"]'), zip || '');
    setNative(document.querySelector('input[name="Email"]'), email);
    const addr = document.querySelector('input[name="Address"]');
    if (addr && /long beach/i.test(addr.value || '')) setNative(addr, '');
    const state = document.querySelector('select[name="State"], #State');
    if (state) {
      const opt = Array.from(state.options || []).find(o => /california|^ca\\b/i.test(o.text || o.value || ''));
      if (opt) { state.value = opt.value; state.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    const country = document.querySelector('select[name="AppCountryID"]');
    if (country) {
      const opt = Array.from(country.options || []).find(o => /united states|^usa$/i.test(o.text || ''));
      if (opt) { country.value = opt.value; country.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    `,
    phoneDashed,
    profile.firstName,
    profile.lastName,
    profile.currentCity,
    profile.zipcode || '90802',
    profile.email
  );
  console.log('AppOne BioInfo: repaired phone/name/city fields');
}

async function waitForNonBlankPage(
  driver: WebDriver,
  fallbackUrl?: string,
  maxMs = 20000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const state = (await driver.executeScript(`
      const href = location.href || '';
      const t = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim();
      const hasUi = document.querySelectorAll('input, button, a, [role="button"]').length > 0;
      return { href, tlen: t.length, hasUi };
    `)) as { href: string; tlen: number; hasUi: boolean };

    if (!/about:blank/i.test(state.href) && (state.tlen > 40 || state.hasUi)) {
      return true;
    }
    if (fallbackUrl && /about:blank/i.test(state.href) && Date.now() - start > 4000) {
      try {
        await driver.get(fallbackUrl);
      } catch {
        // ignore
      }
    }
    await driver.sleep(800);
  }
  return false;
}

async function safeClick(driver: WebDriver, el: WebElement): Promise<void> {
  try {
    await el.click();
  } catch {
    await driver.executeScript('arguments[0].click();', el);
  }
}



async function maybeSoftHoldForBlocker(
  driver: WebDriver,
  job: IJob,
  label: string
): Promise<boolean> {
  const url = await driver.getCurrentUrl();
  const body = await readVisiblePageText(driver);
  const blocker = classifyPageBlocker(url, body);
  if (!blocker) return false;
  // Validation alone mid-fill is normal — only hold on account/captcha mid-flow.
  if (blocker.kind === 'validation') return false;

  if (blocker.kind === 'account') {
    job.applyPhase = 'filling';
    job.approvalNote = `${label}: account wall — signing up / logging in with portal credentials…`;
    await job.save();
    console.log(`Portal auth attempt on ${label}: ${blocker.reason}`);
    const auth = await tryPortalAccountAuth(driver);
    if (auth.ok) {
      job.approvalNote = `${label}: ${auth.method} succeeded — continuing application…`;
      await job.save();
      await driver.sleep(1500);
      // Re-check: captcha may appear after login
      const url2 = await driver.getCurrentUrl();
      const body2 = await readVisiblePageText(driver);
      const again = classifyPageBlocker(url2, body2);
      if (!again || again.kind === 'validation') return false;
      if (again.kind === 'account') {
        // One more OTP/login pass
        const auth2 = await tryPortalAccountAuth(driver);
        if (auth2.ok) return false;
        await markApplyConfusedHold(
          job,
          `${again.reason} Auto-auth: ${auth2.method}${auth2.detail ? ` (${auth2.detail})` : ''}`,
          label
        );
        return true;
      }
      if (again.kind === 'captcha') {
        await markApplyConfusedHold(job, again.reason, label);
        return true;
      }
      return false;
    }
    await markApplyConfusedHold(
      job,
      `${blocker.reason} Auto-auth: ${auth.method}${auth.detail ? ` — ${auth.detail}` : ''}`,
      label
    );
    return true;
  }

  await markApplyConfusedHold(job, blocker.reason, label);
  return true;
}

/**
 * Career-page / ATS apply (primary path).
 * Dedicated Greenhouse/Lever/Ashby/Workday fillers + human Submit gate.
 */
export async function applyCareerPageJob(jobId: string) {
  const job = await Job.findById(jobId);
  if (!job) throw new Error('Job not found');
  if (!job.pdfPath) throw new Error('Upload an approved PDF before applying.');

  await runPreApplySkipCheck(job);

  let applyUrl = sanitizeStoredJobUrl(job.url);
  let detection = detectAts(applyUrl, job.source);
  let label = detection.label;
  let driver: WebDriver | null = null;
  const profile = buildApplyProfile();
  let inGreenhouseFrame = false;

  try {
    job.status = 'applying';
    job.pendingAction = null;
    job.errorMessage = undefined;
    job.atsType = detection.ats;
    job.applyPhase = 'opening';
    // Persist cleaned URL so "View on …" and Retry use the same link
    if (applyUrl && applyUrl !== job.url) {
      job.url = applyUrl;
    }
    job.approvalNote = isJobrightUrl(applyUrl)
      ? 'Opening Jobright — resolving Apply Now to employer career page…'
      : `Opening ${label} career application…`;
    await job.save();

    // Profile-only fill (no Claude/green Chrome mid-apply — resume was already tailored).
    const ctx = buildFormContext(job, profile, undefined);

    const bootstrapUrl =
      detection.ats === 'lever' ? resolveLeverApplyUrl(applyUrl) : applyUrl;

    driver = await attachDriver(orangeProfile(bootstrapUrl));
    await syncOrangeSession(driver, bootstrapUrl);
    // Guaranteed navigation to the stored job link (View on …), even if cookie sync no-ops
    const current = await driver.getCurrentUrl().catch(() => '');
    if (!sameJobDestination(current, bootstrapUrl)) {
      console.log(`Career apply: navigating to stored URL ${bootstrapUrl}`);
      await driver.get(bootstrapUrl);
      await driver.sleep(2500);
    } else {
      await driver.sleep(1500);
    }

    // Jobright listings: click Apply Now → switch to employer ATS URL, then fill there.
    if (isJobrightUrl(applyUrl)) {
      const resolved = await resolveJobrightCareerUrl(driver, { waitMs: 10000 });
      if (!resolved.careerUrl || !isExternalCareerUrl(resolved.careerUrl)) {
        await markApplyConfusedHold(
          job,
          `Could not resolve Jobright Apply Now to a career page (${resolved.method}). Open Apply Now in Chrome and finish manually.`,
          'Jobright'
        );
        return;
      }
      applyUrl = normalizeCareerApplyUrl(resolved.careerUrl);
      job.url = applyUrl;
      detection = detectAts(applyUrl, job.source);
      label = detection.label;
      job.atsType = detection.ats;
      job.approvalNote = `Jobright Apply Now → ${label}. Filling career application…`;
      await job.save();
      console.log(`Jobright apply resolved via ${resolved.method}: ${applyUrl}`);

      await driver.get(
        detection.ats === 'lever' ? resolveLeverApplyUrl(applyUrl) : applyUrl
      );
      await driver.sleep(2500);
    }

    await enterAtsApplyMode(driver, detection.ats, applyUrl);
    await driver.sleep(2000);
    if (!(await waitForNonBlankPage(driver, applyUrl))) {
      await markApplyConfusedHold(
        job,
        'Career page stayed blank/loading after open. Retry Career Apply once Chrome shows the job.',
        label
      );
      return;
    }
    if (detection.ats === 'greenhouse') {
      inGreenhouseFrame = await switchIntoGreenhouseFrame(driver);
    }

    if (await maybeSoftHoldForBlocker(driver, job, label)) return;

    await setApplyPhase(job, 'filling', `Filling ${label} application form…`);

    let step = 0;
    let uploadedOnce = false;
    let knownTotal = 0;
    let applyEntryAttempts = 0;
    let managerTurns = 0;
    let stalledSteps = 0;
    const managerLog: string[] = [];
    const maxSteps = Math.max(18, config.apply.managerMaxTurns + 8);

    const goAwaitSubmit = async (submitBtn: WebElement) => {
      await setApplyPhase(job, 'awaiting_submit');
      await requestSubmitApproval(job, jobId, label);
      const afterApproval = await Job.findById(jobId);
      if (afterApproval?.status === 'applied') {
        // User marked applied manually (extension / tracker) — do not click Submit
        return;
      }
      await setApplyPhase(job, 'submitting', `Submitting on ${label}…`);
      await safeClick(driver!, submitBtn);
      await driver!.sleep(2800);

      try {
        if (inGreenhouseFrame) {
          await driver!.switchTo().defaultContent();
          inGreenhouseFrame = false;
        }
        const bodyText = await readVisiblePageText(driver!);
        const url = await driver!.getCurrentUrl();
        const postBlocker = classifyPageBlocker(url, bodyText);
        if (postBlocker?.kind === 'validation' || postBlocker?.kind === 'captcha') {
          await markApplyConfusedHold(job, postBlocker.reason, label);
          return;
        }
        if (!looksLikeSuccessPage(url, bodyText)) {
          if (
            /applicantlogin|userregistration|securityquestion/i.test(url) ||
            /standard login|new user registration/i.test(bodyText)
          ) {
            await markApplyConfusedHold(
              job,
              'Submit landed on login/registration — application was not completed. Retry after signing in.',
              label
            );
            return;
          }
          job.approvalNote = `Submit clicked on ${label}. Confirm success in Chrome if no thank-you page.`;
          await job.save();
        }
      } catch {
        // ignore verification errors
      }

      await markApplySuccess(job, label);
    };

    while (step < maxSteps) {
      step += 1;
      await driver.sleep(1200);

      if (detection.ats === 'greenhouse' && !inGreenhouseFrame) {
        inGreenhouseFrame = await switchIntoGreenhouseFrame(driver);
      }

      if (await maybeSoftHoldForBlocker(driver, job, label)) return;

      const urlBefore = await driver.getCurrentUrl();
      let progressed = false;

      // Login / registration walls: skip fill/Next spam — go straight to portal auth / manager.
      const loginWall =
        /applicantlogin|userregistration|securityquestion|\/login|\/signin|createaccount|create.?account|jobs\.bytedance\.com|joinbytedance\.com/i.test(
          urlBefore
        ) ||
        !!(await driver.executeScript(`
          const t = (document.body && document.body.innerText || '').toLowerCase();
          return !!(
            document.querySelector('input[type="password"]') ||
            document.querySelector('[data-automation-id="createAccountCheckbox"]') ||
            document.querySelector('[data-automation-id="password"]') ||
            /get code|email verification code|enter email verification/.test(t)
          );
        `));
      if (loginWall && managerTurns < config.apply.managerMaxTurns) {
        // Workday SPA sometimes snapshots as blank mid-nav — wait instead of holding.
        if (!(await waitForNonBlankPage(driver, applyUrl, 12000))) {
          stalledSteps += 1;
          if (stalledSteps >= 3) {
            await markApplyConfusedHold(
              job,
              'Workday/account page stayed blank after retries. Open the job in Chrome, then Retry Career Apply.',
              label
            );
            return;
          }
          continue;
        }
        managerTurns += 1;
        // Prefer trusted portal auth over manager hold on Workday/ByteDance account walls
        if (
          /myworkdayjobs\.com|createaccount|password|bytedance|get code|verification code/i.test(
            urlBefore + ' ' + ((await readVisiblePageText(driver)).slice(0, 500))
          )
        ) {
          const auth = await tryPortalAccountAuth(driver);
          job.approvalNote = `Manager: login — ${auth.method}${auth.detail ? ` (${auth.detail})` : ''}`;
          await job.save();
          console.log(job.approvalNote);
          if (auth.ok) {
            stalledSteps = 0;
            continue;
          }
          if (/please check the box|agree to these terms/i.test(auth.detail || '')) {
            stalledSteps += 1;
            continue;
          }
          // OTP missing — soft hold with clear instruction
          if (/otp_missing|get_code|verification/i.test(auth.method)) {
            await markApplyConfusedHold(
              job,
              `${auth.detail || auth.method}. Check Gmail in orange Chrome if a code was sent, then Retry.`,
              label
            );
            return;
          }
        }
        const snapshot = await captureApplyPageSnapshot(driver);
        if (!snapshot.bodyText.trim() && snapshot.controls.length === 0) {
          stalledSteps += 1;
          continue;
        }
        let action =
          (
            await askApplyManager(snapshot, {
              profile,
              hasResume: !!job.pdfPath,
              jobTitle: job.title || '',
              company: job.company || '',
              lastActions: managerLog,
            })
          ).action || heuristicApplyAction(snapshot);
        if (
          action.type === 'hold' &&
          /blank|loading/i.test(action.reason || '')
        ) {
          stalledSteps += 1;
          continue;
        }
        if (action.type !== 'login' && action.type !== 'hold' && action.type !== 'click') {
          action = { type: 'login', reason: 'Login wall — force portal auth' };
        }
        const exec = await executeApplyManagerAction(driver, action, {
          profile,
          formCtx: ctx,
          pdfPath: job.pdfPath,
        });
        managerLog.push(exec.summary);
        console.log(exec.summary);
        job.approvalNote = exec.summary;
        await job.save();
        if (exec.holdReason && !/blank|loading/i.test(exec.holdReason)) {
          await markApplyConfusedHold(job, exec.holdReason, label);
          return;
        }
        const urlAfterLogin = await driver.getCurrentUrl();
        if (
          exec.ok &&
          !/applicantlogin|userregistration|createaccount/i.test(urlAfterLogin) &&
          !(await driver.executeScript(
            `return !!document.querySelector('input[type="password"], [data-automation-id="password"]')`
          ))
        ) {
          stalledSteps = 0;
          continue;
        }
        // Still on wall after login attempt — one more soft-hold pass, then continue loop
        if (await maybeSoftHoldForBlocker(driver, job, label)) return;
        stalledSteps += 1;
        if (stalledSteps >= 3) {
          await markApplyConfusedHold(
            job,
            'Still on login/registration after Apply Manager login attempts. Finish sign-in in Chrome, then Retry Career Apply.',
            label
          );
          return;
        }
        continue;
      }

      // Still on a JD/landing page (Paychex AppOne, etc.) — click Apply Now again.
      if (applyEntryAttempts < 3) {
        const needsEntry = (await driver.executeScript(`
          const inputs = Array.from(document.querySelectorAll('input, textarea, select')).filter((el) => {
            const t = (el.type || '').toLowerCase();
            if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(t)) return false;
            return el.offsetParent !== null;
          });
          const applyCtas = Array.from(document.querySelectorAll('a, button, [role="button"]')).filter((el) => {
            const text = ((el.innerText || el.value || '') + '').toLowerCase().replace(/\\s+/g, ' ');
            if (!/apply now|start application|apply for this/.test(text)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 2 && r.height > 2;
          });
          return { fields: inputs.length, applyCtas: applyCtas.length };
        `)) as { fields: number; applyCtas: number };
        if ((needsEntry?.fields || 0) < 2 && (needsEntry?.applyCtas || 0) > 0) {
          applyEntryAttempts += 1;
          job.approvalNote = `Opening application form (${label}) — clicking Apply…`;
          await job.save();
          await clickApplyEntryPoint(driver);
          await driver.sleep(2000);
          progressed = true;
          stalledSteps = 0;
          continue;
        }
      }

      const filled = await fillAtsFormFields(driver, detection.ats, ctx);
      knownTotal += filled.knownFilled;
      if (filled.knownFilled > 0) progressed = true;

      await repairAppOneBioFields(driver, profile);

      if (!uploadedOnce) {
        const didUpload = await uploadResumeOnly(driver, job.pdfPath);
        if (didUpload) {
          uploadedOnce = true;
          progressed = true;
          await setApplyPhase(
            job,
            'filling',
            `Resume attached (${knownTotal} known fields) — continuing ${label}…`
          );
        }
      }

      const submitBtn = await findSubmitButton(driver);
      if (submitBtn) {
        await goAwaitSubmit(submitBtn);
        return;
      }

      const nextBtn = await findNextButton(driver);
      if (nextBtn) {
        const fingerprintBefore = await driver.executeScript(`
          return (location.href + '|' + (document.body && document.body.innerText || '').slice(0, 400));
        `);
        await safeClick(driver, nextBtn);
        await driver.sleep(1500);
        if (detection.ats === 'greenhouse') {
          await driver.switchTo().defaultContent();
          inGreenhouseFrame = false;
          await driver.sleep(800);
          inGreenhouseFrame = await switchIntoGreenhouseFrame(driver);
        }
        const fingerprintAfter = await driver.executeScript(`
          return (location.href + '|' + (document.body && document.body.innerText || '').slice(0, 400));
        `);
        if (fingerprintAfter !== fingerprintBefore) {
          progressed = true;
          stalledSteps = 0;
          continue;
        }
        // Next/Continue was a no-op — fall through to Apply Manager
        console.log('Career apply: Next/Continue did not change page — asking Apply Manager');
      }

      const urlAfterHeuristic = await driver.getCurrentUrl();
      if (urlAfterHeuristic !== urlBefore) progressed = true;

      if (progressed) {
        stalledSteps = 0;
        continue;
      }

      stalledSteps += 1;

      // Heuristics stalled — ask Apply Manager (API only; no green Claude).
      if (managerTurns >= config.apply.managerMaxTurns) {
        await markApplyConfusedHold(
          job,
          `Apply Manager reached ${managerTurns} turns without Submit — finish in Chrome, then mark Applied if needed.`,
          label
        );
        return;
      }

      managerTurns += 1;
      let snapshot;
      try {
        snapshot = await captureApplyPageSnapshot(driver);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markApplyConfusedHold(
          job,
          `Could not snapshot page for Apply Manager (${msg.slice(0, 100)}).`,
          label
        );
        return;
      }

      const asked = await askApplyManager(snapshot, {
        profile,
        hasResume: !!job.pdfPath,
        jobTitle: job.title || '',
        company: job.company || '',
        lastActions: managerLog,
      });

      let action = asked.action;
      if (!action) {
        // One heuristic fallback from snapshot, then hold if still stuck next loop
        action = heuristicApplyAction(snapshot);
        job.approvalNote = `Manager API unavailable (${asked.error || 'no action'}) — heuristic: ${action.type}`;
        await job.save();
      }
      // Non-null after heuristic fallback
      const decided = action;

      // Break loops: same fill/click repeated → force next, then hold
      let toRun = decided;
      if (
        decided.type === 'fill' &&
        decided.label &&
        managerLog.slice(-4).filter((s) => s.includes(`fill "${decided.label}"`)).length >= 2
      ) {
        console.log(`Apply Manager: breaking repeat fill "${decided.label}" → next`);
        toRun = { type: 'next', reason: `Break repeat fill ${decided.label}` };
      } else if (
        decided.type === 'click' &&
        managerLog.slice(-3).some((s) => s.includes('click') && s.includes('failed'))
      ) {
        toRun = { type: 'next', reason: 'Break failed click loop' };
      }

      const actionKey = `${toRun.type}:${toRun.label || ''}:${toRun.text || ''}:${toRun.valueKey || ''}`;
      const exec = await executeApplyManagerAction(driver, toRun, {
        profile,
        formCtx: ctx,
        pdfPath: job.pdfPath,
      });
      managerLog.push(`${exec.summary} [${actionKey}]`);
      console.log(exec.summary);
      job.approvalNote = exec.summary;
      await job.save();

      // After a successful single-field fill, try Next only if no validation banner
      if (exec.ok && toRun.type === 'fill') {
        const hasInvalid = (await driver.executeScript(`
          const t = (document.body && document.body.innerText || '');
          return /invalid main phone|invalid .*phone|required field/i.test(t);
        `)) as boolean;
        if (!hasInvalid) {
          const nextAfterFill = await findNextButton(driver);
          if (nextAfterFill) {
            await safeClick(driver, nextAfterFill);
            await driver.sleep(1500);
            managerLog.push('Manager: auto-next after fill');
            console.log('Manager: auto-next after fill');
            stalledSteps = 0;
            continue;
          }
        } else if (/phone/i.test(toRun.label || '')) {
          // Force dashed phone once when validation complains
          const digits = profile.phone.replace(/\D/g, '');
          const ten =
            digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
          if (ten.length === 10) {
            await executeApplyManagerAction(
              driver,
              {
                type: 'fill',
                label: 'Phone',
                value: `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`,
                reason: 'Force XXX-XXX-XXXX for AppOne',
              },
              { profile, formCtx: ctx, pdfPath: job.pdfPath }
            );
          }
        }
      }

      if (exec.holdReason) {
        if (/blank|loading/i.test(exec.holdReason)) {
          stalledSteps += 1;
          await waitForNonBlankPage(driver, applyUrl, 10000);
          continue;
        }
        await markApplyConfusedHold(job, exec.holdReason, label);
        return;
      }

      if (exec.doneCheck) {
        const bodyText = await readVisiblePageText(driver);
        const url = await driver.getCurrentUrl();
        if (looksLikeSuccessPage(url, bodyText)) {
          await markApplySuccess(job, label);
          return;
        }
        // Not actually done — keep going
        stalledSteps = 0;
        continue;
      }

      if (exec.awaitSubmit) {
        const btn = await findSubmitButton(driver);
        if (btn) {
          await goAwaitSubmit(btn);
          return;
        }
        // Manager thought submit was ready but button not found — soft continue
        stalledSteps = 0;
        continue;
      }

      if (exec.ok) {
        stalledSteps = 0;
        if (toRun.type === 'upload_resume') uploadedOnce = true;
        if (detection.ats === 'greenhouse') {
          await driver.switchTo().defaultContent();
          inGreenhouseFrame = false;
          await driver.sleep(600);
          inGreenhouseFrame = await switchIntoGreenhouseFrame(driver);
        }
        continue;
      }

      // Manager action failed — one more heuristic fill, then hold on next stall
      await fillAtsFormFields(driver, detection.ats, ctx);
      if (stalledSteps >= 2 && !asked.action) {
        await markApplyConfusedHold(
          job,
          asked.error
            ? `Apply Manager failed (${asked.error.slice(0, 120)}). Finish in Chrome.`
            : `Could not advance after Manager: ${toRun.type}. Finish in Chrome.`,
          label
        );
        return;
      }
    }

    await markApplyConfusedHold(
      job,
      'Application flow exceeded step limit — finish manually in Chrome.',
      label
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cancelled or timed out/i.test(message)) {
      await markApplyFailed(job, err, label);
      return;
    }
    // Chromedriver bridge died (e.g. old global pkill) — soft-hold instead of opaque ECONNREFUSED
    if (/ECONNREFUSED|chrome not reachable|disconnected|invalid session/i.test(message)) {
      await markApplyConfusedHold(
        job,
        `Browser session disconnected mid-apply (${message.slice(0, 80)}). Orange Chrome should still be open — click Retry Career Apply.`,
        label
      );
      return;
    }
    try {
      await markApplyConfusedHold(job, message, label);
    } catch {
      await markApplyFailed(job, err, label);
    }
  } finally {
    try {
      if (driver && inGreenhouseFrame) {
        await driver.switchTo().defaultContent();
      }
    } catch {
      // ignore
    }
    await cleanupApplySession();
    await releaseDriver(driver);
  }
}
