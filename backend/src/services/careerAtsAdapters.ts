/**
 * Dedicated ATS form fillers for Greenhouse / Lever / Ashby / Workday.
 * Falls back to genericFormQuestions for anything not matched.
 */
import path from 'path';
import { By, Key, WebDriver, WebElement } from 'selenium-webdriver';
import type { ApplicationProfile } from '../data/applicationProfile';
import type { FormQuestionContext } from './applyHelpers';
import {
  GREENHOUSE_FIELD_SELECTORS,
  LEVER_FIELD_SELECTORS,
  WORKDAY_AUTOMATION_IDS,
  isCoverLetterFileField,
  isHoneypotField,
} from './careerApplyUtils';
import { fillGenericFormFields } from './genericFormQuestions';

async function setInputValue(
  driver: WebDriver,
  el: WebElement,
  value: string,
  overwrite: boolean
): Promise<boolean> {
  if (!value) return false;
  try {
    const displayed = await el.isDisplayed().catch(() => true);
    // Allow visually-hidden file-adjacent text fields; skip truly hidden honeypots via caller.
    const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
    if (type === 'hidden') return false;
    if (!displayed && type !== 'file') {
      // Still try aria fields that report not displayed incorrectly.
    }
    const prev = (await el.getAttribute('value')) || '';
    if (!overwrite && prev.trim()) return false;
    await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', el);
    await el.clear().catch(() => undefined);
    await el.click().catch(() => undefined);
    await el.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE).catch(() => undefined);
    await el.sendKeys(value);
    return true;
  } catch {
    return false;
  }
}

async function fillFirstMatching(
  driver: WebDriver,
  selectors: readonly string[],
  value: string,
  overwrite: boolean
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const els = await driver.findElements(By.css(selector));
      for (const el of els) {
        const name = (await el.getAttribute('name')) || '';
        const id = (await el.getAttribute('id')) || '';
        if (isHoneypotField(name) || isHoneypotField(id)) continue;
        if (await setInputValue(driver, el, value, overwrite)) return true;
      }
    } catch {
      // invalid selector variants — continue
    }
  }
  return false;
}

async function uploadToSelectors(
  driver: WebDriver,
  selectors: readonly string[],
  pdfPath: string
): Promise<boolean> {
  const abs = path.resolve(pdfPath);
  for (const selector of selectors) {
    try {
      const els = await driver.findElements(By.css(selector));
      for (const el of els) {
        const id = (await el.getAttribute('id')) || '';
        const name = (await el.getAttribute('name')) || '';
        if (isCoverLetterFileField(id) || isCoverLetterFileField(name)) continue;
        try {
          await el.sendKeys(abs);
          return true;
        } catch {
          // try next
        }
      }
    } catch {
      // continue
    }
  }
  return false;
}

/** Upload resume only — never attach PDF to cover-letter file inputs. */
export async function uploadResumeOnly(
  driver: WebDriver,
  pdfPath: string
): Promise<boolean> {
  const abs = path.resolve(pdfPath);

  // AppOne UploadResume.aspx: activate local file picker first
  try {
    const url = await driver.getCurrentUrl();
    if (/uploadresume\.aspx/i.test(url)) {
      const fsBtn = await driver.findElements(
        By.css('#cphBody_SubmitFS, input[name*="SubmitFS"], input[value*="File System"]')
      );
      for (const btn of fsBtn) {
        try {
          if (await btn.isDisplayed()) {
            await driver.executeScript('arguments[0].click();', btn);
            await driver.sleep(400);
            break;
          }
        } catch {
          // continue
        }
      }
      const appOneFile = await driver.findElements(
        By.css('#cphBody_ResumeFile, input[name*="ResumeFile"], input[type="file"][id*="Resume"]')
      );
      for (const el of appOneFile) {
        try {
          await el.sendKeys(abs);
          await driver.sleep(600);
          await driver.executeScript(
            `
            const f = arguments[0];
            f.dispatchEvent(new Event('input', { bubbles: true }));
            f.dispatchEvent(new Event('change', { bubbles: true }));
            `,
            el
          );
          // AppOne requires Import before Submit Resume registers the file
          try {
            const importBtns = await driver.findElements(
              By.css('#cphBody_btnImport, input[name*="btnImport"]')
            );
            for (const imp of importBtns) {
              try {
                await driver.executeScript('arguments[0].click();', imp);
                await driver.sleep(1500);
                break;
              } catch {
                // next
              }
            }
          } catch {
            // optional
          }
          const has = (await driver.executeScript(
            'return !!(arguments[0].files && arguments[0].files.length);',
            el
          )) as boolean;
          if (has) return true;
          // Import may navigate / clear input but still succeed
          const body = await driver.getPageSource();
          if (/successfully uploaded|upload is complete|document was successfully/i.test(body)) {
            return true;
          }
          return true;
        } catch {
          // try next
        }
      }
    }
  } catch {
    // fall through to generic
  }

  const preferred = [
    ...GREENHOUSE_FIELD_SELECTORS.resume,
    ...LEVER_FIELD_SELECTORS.resume,
    'input[type="file"][name*="resume"]',
    'input[type="file"][id*="resume"]',
    'input[type="file"][name*="Resume"]',
    'input[type="file"][id*="Resume"]',
    'input[type="file"][name*="cv"]',
    'input[type="file"][id*="cv"]',
  ];
  if (await uploadToSelectors(driver, preferred, pdfPath)) return true;

  const all = await driver.findElements(By.css('input[type="file"]'));
  for (const el of all) {
    const id = (await el.getAttribute('id')) || '';
    const name = (await el.getAttribute('name')) || '';
    const aria = (await el.getAttribute('aria-label')) || '';
    if (
      isCoverLetterFileField(id) ||
      isCoverLetterFileField(name) ||
      isCoverLetterFileField(aria)
    ) {
      continue;
    }
    try {
      await el.sendKeys(abs);
      return true;
    } catch {
      // next
    }
  }
  return false;
}

export async function fillGreenhouseKnownFields(
  driver: WebDriver,
  profile: ApplicationProfile
): Promise<number> {
  const o = profile.overwritePreviousAnswers;
  let n = 0;
  if (await fillFirstMatching(driver, GREENHOUSE_FIELD_SELECTORS.firstName, profile.firstName, o))
    n += 1;
  if (await fillFirstMatching(driver, GREENHOUSE_FIELD_SELECTORS.lastName, profile.lastName, o))
    n += 1;
  if (await fillFirstMatching(driver, GREENHOUSE_FIELD_SELECTORS.email, profile.email, o)) n += 1;
  if (await fillFirstMatching(driver, GREENHOUSE_FIELD_SELECTORS.phone, profile.phone, o)) n += 1;
  if (await fillFirstMatching(driver, GREENHOUSE_FIELD_SELECTORS.linkedin, profile.linkedin, o))
    n += 1;
  if (await fillFirstMatching(driver, GREENHOUSE_FIELD_SELECTORS.website, profile.website, o))
    n += 1;
  if (
    await fillFirstMatching(
      driver,
      GREENHOUSE_FIELD_SELECTORS.coverLetterText,
      profile.coverLetter,
      o
    )
  ) {
    n += 1;
  }
  return n;
}

export async function fillLeverKnownFields(
  driver: WebDriver,
  profile: ApplicationProfile
): Promise<number> {
  const o = profile.overwritePreviousAnswers;
  let n = 0;
  if (await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.name, profile.fullName, o)) n += 1;
  if (await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.email, profile.email, o)) n += 1;
  if (await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.phone, profile.phone, o)) n += 1;
  if (await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.org, profile.recentEmployer, o))
    n += 1;
  if (await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.linkedin, profile.linkedin, o)) n += 1;
  if (await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.portfolio, profile.website, o)) n += 1;
  if (
    await fillFirstMatching(driver, LEVER_FIELD_SELECTORS.coverLetter, profile.coverLetter, o)
  ) {
    n += 1;
  }
  return n;
}

/**
 * Ashby uses React controls; Yes/No often render as buttons next to the question.
 */
export async function fillAshbyYesNoButtons(
  driver: WebDriver,
  profile: ApplicationProfile
): Promise<number> {
  const sponsorshipNo = !profile.nowRequireSponsorship.toLowerCase().includes('yes');
  const rules: Array<{ pattern: string; answer: string }> = [
    { pattern: 'authorized to work|legally authorized|eligible to work', answer: 'Yes' },
    {
      pattern: 'now or in the future|now or future|currently or in the future',
      answer: profile.futureRequireSponsorship || 'Yes',
    },
    {
      pattern: 'future sponsorship|sponsor.*future|will you.*sponsor',
      answer: profile.futureRequireSponsorship || 'Yes',
    },
    {
      pattern: 'currently require sponsorship|now require sponsorship|do you now.*sponsor',
      answer: sponsorshipNo ? 'No' : 'Yes',
    },
    {
      pattern: 'require sponsorship|need sponsorship|visa sponsorship|require visa',
      answer: profile.requireVisa || 'Yes',
    },
    {
      pattern: 'willing to relocate|able to relocate|relocate',
      answer: profile.willingToRelocate || 'Yes',
    },
    { pattern: 'previously employed|worked for .+ before|former employee', answer: 'No' },
  ];

  let clicked = 0;
  for (const rule of rules) {
    try {
      const matched = (await driver.executeScript(
        `
        const pattern = arguments[0];
        const answer = arguments[1];
        const re = new RegExp(pattern, 'i');
        const walk = Array.from(document.querySelectorAll('label, p, div, span, h3, h4, legend, li'));
        for (const el of walk) {
          const text = (el.innerText || '').trim();
          if (!text || text.length < 8 || text.length > 240) continue;
          if (!re.test(text)) continue;
          const root = el.closest('div, fieldset, section, li, form') || el.parentElement;
          if (!root || typeof root.querySelectorAll !== 'function') continue;
          const buttons = Array.from(root.querySelectorAll('button, [role="button"], [role="radio"], input[type="radio"] + label'));
          for (const btn of buttons) {
            const t = (btn.innerText || btn.getAttribute('aria-label') || btn.value || '').trim();
            if (t.toLowerCase() === answer.toLowerCase()) {
              btn.click();
              return true;
            }
          }
        }
        return false;
        `,
        rule.pattern,
        rule.answer
      )) as boolean;
      if (matched) clicked += 1;
    } catch {
      // continue
    }
  }
  return clicked;
}

export async function fillWorkdayKnownFields(
  driver: WebDriver,
  profile: ApplicationProfile
): Promise<number> {
  const o = profile.overwritePreviousAnswers;
  let n = 0;

  async function byAutomationIds(ids: readonly string[], value: string): Promise<boolean> {
    for (const id of ids) {
      const selectors = [
        `[data-automation-id="${id}"]`,
        `input[data-automation-id="${id}"]`,
        `textarea[data-automation-id="${id}"]`,
      ];
      if (await fillFirstMatching(driver, selectors, value, o)) return true;
    }
    return false;
  }

  // Never fill password / beecatcher on Workday account walls.
  if (await byAutomationIds(WORKDAY_AUTOMATION_IDS.firstName, profile.firstName)) n += 1;
  if (await byAutomationIds(WORKDAY_AUTOMATION_IDS.lastName, profile.lastName)) n += 1;
  if (await byAutomationIds(WORKDAY_AUTOMATION_IDS.email, profile.email)) n += 1;
  if (await byAutomationIds(WORKDAY_AUTOMATION_IDS.phone, profile.phone)) n += 1;
  return n;
}

/**
 * ATS-aware fill: known selectors first, then generic sweep.
 */
export async function fillAtsFormFields(
  driver: WebDriver,
  ats: string,
  ctx: FormQuestionContext
): Promise<{ knownFilled: number; ashbyYesNo: number }> {
  let knownFilled = 0;
  let ashbyYesNo = 0;
  const profile = ctx.profile;

  if (ats === 'greenhouse') {
    knownFilled += await fillGreenhouseKnownFields(driver, profile);
  } else if (ats === 'lever') {
    knownFilled += await fillLeverKnownFields(driver, profile);
  } else if (ats === 'workday') {
    knownFilled += await fillWorkdayKnownFields(driver, profile);
  } else if (ats === 'ashby') {
    ashbyYesNo += await fillAshbyYesNoButtons(driver, profile);
  }

  await fillGenericFormFields(driver, driver, ctx);
  return { knownFilled, ashbyYesNo };
}

export async function readVisiblePageText(driver: WebDriver, max = 6000): Promise<string> {
  try {
    const text = await driver.findElement(By.css('body')).getText();
    return text.slice(0, max);
  } catch {
    return '';
  }
}
