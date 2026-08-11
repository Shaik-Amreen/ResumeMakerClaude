/**
 * Execute Apply Manager actions on orange Chrome using existing Selenium helpers.
 */
import { By, Key, WebDriver, WebElement } from 'selenium-webdriver';
import type { ApplicationProfile } from '../data/applicationProfile';
import type { FormQuestionContext } from './applyHelpers';
import {
  type ApplyManagerAction,
  profileFactsForManager,
} from './applyManager';
import { uploadResumeOnly } from './careerAtsAdapters';
import {
  clickApplyEntryPoint,
  fillGenericFormFields,
  findNextButton,
  findSubmitButton,
} from './genericFormQuestions';
import { tryPortalAccountAuth } from './portalAccountAuth';

export type ManagerExecResult = {
  ok: boolean;
  summary: string;
  /** Stop the fill loop and request human submit */
  awaitSubmit?: boolean;
  /** Soft-hold with this reason */
  holdReason?: string;
  /** Page already looks successful */
  doneCheck?: boolean;
};

async function safeClick(driver: WebDriver, el: WebElement): Promise<void> {
  try {
    await el.click();
  } catch {
    await driver.executeScript('arguments[0].click();', el);
  }
}

function resolveFillValue(
  action: ApplyManagerAction,
  profile: ApplicationProfile
): string {
  if (action.value && action.value.trim()) {
    const v = action.value.trim();
    // Normalize phone literals the model invents
    if (/phone/i.test(action.label || action.valueKey || '')) {
      const digits = v.replace(/\D/g, '');
      const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
      if (ten.length === 10) return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
    }
    return v;
  }
  const key = (action.valueKey || '').trim();
  const label = (action.label || '').toLowerCase();
  if (/phone|mobile/i.test(label) || /phone/i.test(key)) {
    const digits = profile.phone.replace(/\D/g, '');
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
    if (ten.length === 10) return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  if (!key) return '';
  const facts = profileFactsForManager(profile) as Record<string, string>;
  if (facts[key] != null && String(facts[key]).length) return String(facts[key]);
  const aliases: Record<string, string> = {
    city: profile.currentCity,
    phone: profile.phone,
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    state: profile.state,
    zip: profile.zipcode,
    zipcode: profile.zipcode,
    country: profile.country,
    linkedin: profile.linkedin,
    website: profile.website,
    employer: profile.recentEmployer,
    recentEmployer: profile.recentEmployer,
  };
  return aliases[key] || '';
}

async function clickByVisibleText(driver: WebDriver, text: string): Promise<boolean> {
  const needle = text.trim();
  if (!needle) return false;

  // Prefer Apply entry helper for apply-ish text
  if (/^apply(\s+now)?$/i.test(needle) || /start application|apply for this/i.test(needle)) {
    if (await clickApplyEntryPoint(driver)) return true;
  }

  const xpaths = [
    `//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${needle.toLowerCase().replace(/"/g, '')}")]`,
    `//a[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${needle.toLowerCase().replace(/"/g, '')}")]`,
    `//input[(translate(@value, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")="${needle.toLowerCase().replace(/"/g, '')}")]`,
    `//*[@role="button" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${needle.toLowerCase().replace(/"/g, '')}")]`,
  ];

  for (const xpath of xpaths) {
    try {
      const els = await driver.findElements(By.xpath(xpath));
      for (const el of els) {
        try {
          if (await el.isDisplayed() && await el.isEnabled()) {
            await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', el);
            await safeClick(driver, el);
            await driver.sleep(1200);
            return true;
          }
        } catch {
          // next
        }
      }
    } catch {
      // next xpath
    }
  }

  // DOM fallback: exact-ish match
  const clicked = (await driver.executeScript(
    `
    const needle = (arguments[0] || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    if (!needle) return false;
    const nodes = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]'));
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '')
        .toLowerCase().replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      if (text === needle || text.includes(needle) || needle.includes(text)) {
        el.click();
        return true;
      }
    }
    return false;
    `,
    needle
  )) as boolean;

  if (clicked) await driver.sleep(1200);
  return !!clicked;
}

async function fillFieldByLabel(
  driver: WebDriver,
  labelHint: string,
  value: string
): Promise<boolean> {
  if (!value) return false;
  const hint = (labelHint || '').toLowerCase().trim();

  const filled = (await driver.executeScript(
    `
    const hint = (arguments[0] || '').toLowerCase();
    const value = arguments[1] || '';
    if (!value) return false;

    function labelFor(el) {
      const id = el.id;
      if (id) {
        try {
          const lab = document.querySelector('label[for="' + id.replace(/"/g, '') + '"]');
          if (lab && lab.innerText) return lab.innerText.trim();
        } catch (e) {}
      }
      return (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        el.id ||
        ''
      );
    }

    function setNative(el, val) {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const fields = Array.from(document.querySelectorAll('input, textarea, select')).filter((el) => {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'file', 'submit', 'button', 'password'].includes(t)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });

    let best = null;
    let bestScore = 0;
    for (const el of fields) {
      const lab = (labelFor(el) || '').toLowerCase();
      if (!lab) continue;
      let score = 0;
      if (!hint) score = el.value ? 0 : 1;
      else if (lab === hint) score = 10;
      else if (lab.includes(hint) || hint.includes(lab)) score = 6;
      else {
        const tokens = hint.split(/\\s+/).filter(Boolean);
        score = tokens.filter((t) => lab.includes(t)).length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best || bestScore < 1) return false;
    if (best.tagName.toLowerCase() === 'select') {
      const opts = Array.from(best.options || []);
      const low = value.toLowerCase();
      const match = opts.find((o) => (o.text || '').toLowerCase().includes(low) || (o.value || '').toLowerCase() === low);
      if (match) {
        best.value = match.value;
        best.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }
    setNative(best, value);
    return true;
    `,
    hint,
    value
  )) as boolean;

  return !!filled;
}

/**
 * Run one manager action against the live page.
 */
export async function executeApplyManagerAction(
  driver: WebDriver,
  action: ApplyManagerAction,
  opts: {
    profile: ApplicationProfile;
    formCtx: FormQuestionContext;
    pdfPath?: string | null;
  }
): Promise<ManagerExecResult> {
  const reason = action.reason ? ` (${action.reason})` : '';

  switch (action.type) {
    case 'login': {
      const auth = await tryPortalAccountAuth(driver);
      return {
        ok: auth.ok,
        summary: `Manager: login — ${auth.method}${auth.detail ? ` (${auth.detail})` : ''}${reason}`,
      };
    }

    case 'click': {
      const text = action.text || 'Apply Now';
      // Model sometimes returns element ids/classes instead of visible text
      if (/^buttonprimary$|btnsubmit|ucbuttons/i.test(text.replace(/\s+/g, ''))) {
        const nextBtn = await findNextButton(driver);
        if (nextBtn) {
          await safeClick(driver, nextBtn);
          await driver.sleep(1200);
          return { ok: true, summary: `Manager: click next (id hint "${text}")${reason}` };
        }
        for (const label of ['Continue', 'Next', 'Save and Continue', 'Submit']) {
          if (await clickByVisibleText(driver, label)) {
            return { ok: true, summary: `Manager: click "${label}" (from id hint)${reason}` };
          }
        }
      }
      const ok = await clickByVisibleText(driver, text);
      if (!ok) {
        // Try Continue/Next when click target looked like a submit control
        if (/submit|continue|next|save/i.test(text + (action.reason || ''))) {
          const nextBtn = await findNextButton(driver);
          if (nextBtn) {
            await safeClick(driver, nextBtn);
            await driver.sleep(1200);
            return { ok: true, summary: `Manager: next after click miss${reason}` };
          }
        }
      }
      return {
        ok,
        summary: ok
          ? `Manager: click "${text}"${reason}`
          : `Manager: click "${text}" failed${reason}`,
      };
    }

    case 'fill': {
      const value = resolveFillValue(action, opts.profile);
      if (action.label && value) {
        const ok = await fillFieldByLabel(driver, action.label, value);
        if (ok) {
          return { ok: true, summary: `Manager: fill "${action.label}"${reason}` };
        }
      }
      // Broad fill using existing profile map
      await fillGenericFormFields(driver, driver, opts.formCtx);
      // After filling, advance if a Next/Continue is available
      const nextBtn = await findNextButton(driver);
      if (nextBtn) {
        await safeClick(driver, nextBtn);
        await driver.sleep(1200);
        return { ok: true, summary: `Manager: fill + next${reason}` };
      }
      return { ok: true, summary: `Manager: fill profile fields${reason}` };
    }

    case 'upload_resume': {
      if (!opts.pdfPath) {
        return { ok: false, summary: `Manager: upload_resume — no PDF path${reason}` };
      }
      const ok = await uploadResumeOnly(driver, opts.pdfPath);
      if (ok) {
        // AppOne: after file selected, click Submit Resume / Continue
        const nextBtn = await findNextButton(driver);
        if (nextBtn) {
          await safeClick(driver, nextBtn);
          await driver.sleep(1500);
          return {
            ok: true,
            summary: `Manager: upload_resume + next${reason}`,
          };
        }
      }
      return {
        ok,
        summary: ok
          ? `Manager: upload_resume${reason}`
          : `Manager: upload_resume failed${reason}`,
      };
    }

    case 'next': {
      const nextBtn = await findNextButton(driver);
      if (nextBtn) {
        await safeClick(driver, nextBtn);
        await driver.sleep(1200);
        return { ok: true, summary: `Manager: next${reason}` };
      }
      // Fallback: click Continue-like text
      const ok = await clickByVisibleText(driver, action.text || 'Continue');
      return {
        ok,
        summary: ok ? `Manager: next (fallback click)${reason}` : `Manager: next failed${reason}`,
      };
    }

    case 'await_submit': {
      const submit = await findSubmitButton(driver);
      return {
        ok: !!submit,
        awaitSubmit: true,
        summary: `Manager: await_submit${reason}`,
      };
    }

    case 'hold': {
      return {
        ok: true,
        holdReason: action.reason || 'Manager requested hold',
        summary: `Manager: hold — ${action.reason || 'unclear page'}${reason}`,
      };
    }

    case 'done_check': {
      return {
        ok: true,
        doneCheck: true,
        summary: `Manager: done_check${reason}`,
      };
    }

    default:
      return { ok: false, summary: `Manager: unknown action` };
  }
}

/** Optional: nudge empty fields with sendKeys when native setter isn't enough. */
export async function nudgeFocusedValue(driver: WebDriver, value: string): Promise<void> {
  try {
    const active = await driver.switchTo().activeElement();
    await active.sendKeys(Key.chord(Key.CONTROL, 'a'), Key.BACK_SPACE, value);
  } catch {
    // ignore
  }
}
