/**
 * Auto login / sign-up on ATS account walls (AppOne, Workday, generic portals).
 * Uses APPLY_PORTAL_EMAIL + APPLY_PORTAL_PASSWORD; fetches Gmail OTP when needed.
 */
import { By, Key, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { detectAccountWall } from './careerApplyUtils';

export interface PortalCredentials {
  email: string;
  password: string;
}

export function getPortalCredentials(): PortalCredentials | null {
  const email = (config.apply.portalEmail || '').trim();
  const password = config.apply.portalPassword || '';
  if (!email || !password) return null;
  return { email, password };
}

/** AppOne usernames: 8–18 chars, letters+numbers (may include . - _). */
export function derivePortalUsername(email: string): string {
  const configured = (config.apply.portalUsername || '').trim();
  if (configured) return configured.slice(0, 18);

  let base = (email.split('@')[0] || 'applicant')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 16);
  if (base.length < 8) base = `${base}user1234`.slice(0, 12);
  if (!/\d/.test(base)) base = `${base.slice(0, 17)}1`;
  return base.slice(0, 18);
}

async function dismissCookieBanners(driver: WebDriver): Promise<void> {
  try {
    await driver.executeScript(`
      const nodes = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
      for (const el of nodes) {
        const t = ((el.innerText || el.value || '') + '').trim().toLowerCase();
        if (/^(continue|accept|agree|got it|ok)$/i.test(t) || /accept (all )?cookies|agree to/.test(t)) {
          el.click();
          return true;
        }
      }
      return false;
    `);
    await driver.sleep(600);
  } catch {
    // ignore
  }
}

/**
 * AppOne: email → Standard Login → New User Registration (username + password ×2).
 */
async function tryAppOneAuth(
  driver: WebDriver,
  creds: PortalCredentials
): Promise<{ ok: boolean; method: string; detail?: string } | null> {
  const url = (await driver.getCurrentUrl()).toLowerCase();
  if (!/appone\.com/i.test(url)) return null;

  await dismissCookieBanners(driver);

  // Step A: email-only ApplicantLogin
  const emailEl = await driver.findElements(By.css('#Email, input[name="Email"]'));
  const standardLogin = await driver.findElements(By.css('#btnContinue'));
  if (emailEl.length && standardLogin.length) {
    try {
      await driver.executeScript(
        `
        const email = arguments[0];
        const el = document.getElementById('Email') || document.querySelector('input[name="Email"]');
        if (el) {
          el.focus();
          el.value = email;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const btn = document.getElementById('btnContinue');
        if (btn) btn.click();
        `,
        creds.email
      );
      await driver.sleep(4000);
    } catch (err) {
      return {
        ok: false,
        method: 'appone_email_failed',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  await dismissCookieBanners(driver);

  // Step B: registration / login with username + password
  const userFields = await driver.findElements(
    By.css(
      '#cphBody_txtUsername, input[name*="txtUsername"], input[id*="Username"], input[name*="Username"]'
    )
  );
  const passFields = await driver.findElements(By.css('input[type="password"]'));
  if (!userFields.length && !passFields.length) {
    return {
      ok: false,
      method: 'appone_no_form',
      detail: 'AppOne email submitted but registration/login form not found',
    };
  }

  const username = derivePortalUsername(creds.email);
  const usernameCandidates = Array.from(
    new Set([username, 'karthikkovi01', 'karthikkovik1'].filter(Boolean))
  );

  let lastFilled: { user: string | null; passLens: number[] } | null = null;
  for (const candidate of usernameCandidates) {
    // AppOne ASP.NET ignores Selenium sendKeys — use the native value setter.
    lastFilled = (await driver.executeScript(
      `
      const username = arguments[0];
      const password = arguments[1];
      function nativeSet(el, v) {
        if (!el) return false;
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }
      const u =
        document.getElementById('cphBody_txtUsername') ||
        document.querySelector('input[name*="txtUsername"]') ||
        document.querySelector('input[id*="Username"]');
      nativeSet(u, username);
      const passes = Array.from(document.querySelectorAll('input[type="password"]'));
      for (const p of passes) nativeSet(p, password);
      return {
        user: u ? u.value : null,
        passLens: passes.map((p) => (p.value || '').length),
      };
      `,
      candidate,
      creds.password
    )) as { user: string | null; passLens: number[] };
    console.log('AppOne registration/login fill', candidate, lastFilled);

    const submit = await driver.findElements(
      By.css('#ucButtons_btnSubmit, input[name*="btnSubmit"], input[value="Continue"], input[value="Login"], input[value="Sign In"]')
    );
    if (submit.length) {
      try {
        await driver.executeScript('arguments[0].click();', submit[0]);
      } catch {
        await submit[0].click();
      }
    } else {
      await clickAuthButton(driver, 'any');
    }
    await driver.sleep(3500);

    await completeAppOneSecurityQuestion(driver);

    const urlNow = await driver.getCurrentUrl();
    const bodyNow =
      ((await driver.executeScript(
        'return (document.body && document.body.innerText || "").slice(0, 3000);'
      )) as string) || '';
    if (/username is not valid|password is not valid|invalid user|incorrect/i.test(bodyNow)) {
      console.log('AppOne auth rejected for', candidate, '— trying next username');
      continue;
    }
    if (!/ApplicantLogin|UserRegistration|SecurityQuestion/i.test(urlNow)) {
      return {
        ok: true,
        method: 'appone_signup',
        detail: `Registered/logged in as ${candidate}`,
      };
    }
    // Still on auth with no hard error — break and fall through to OTP / final checks
    break;
  }

  const filled = lastFilled;
  console.log('AppOne final fill state', filled);

  if (await pageLooksLikeOtp(driver)) {
    const code = await fetchGmailVerificationCode(driver);
    if (!code) {
      return {
        ok: false,
        method: 'appone_otp_missing',
        detail: 'AppOne asked for a code but none found in Gmail',
      };
    }
    await fillOtp(driver, code);
    await clickAuthButton(driver, 'any');
    await driver.sleep(2500);
  }

  const urlAfter = await driver.getCurrentUrl();
  const bodyAfter =
    ((await driver.executeScript(
      'return (document.body && document.body.innerText || "").slice(0, 4000);'
    )) as string) || '';

  // Still on registration with validation errors
  if (/username is not valid|password is not valid|already (exists|taken)/i.test(bodyAfter)) {
    return {
      ok: false,
      method: 'appone_conflict',
      detail: 'Username/password rejected — may already exist; try login in Chrome',
    };
  }

  const wall = detectAccountWall(urlAfter, bodyAfter);
  // Left the auth funnel → success
  if (!/ApplicantLogin|UserRegistration|SecurityQuestion/i.test(urlAfter)) {
    return {
      ok: true,
      method: 'appone_signup',
      detail: `Registered/logged in as ${filled?.user || username}`,
    };
  }
  // Security question may still be up — retry once
  if (/SecurityQuestion/i.test(urlAfter)) {
    await completeAppOneSecurityQuestion(driver);
    const url2 = await driver.getCurrentUrl();
    if (!/ApplicantLogin|UserRegistration|SecurityQuestion/i.test(url2)) {
      return {
        ok: true,
        method: 'appone_signup',
        detail: `Registered/logged in as ${filled?.user || username}`,
      };
    }
  }
  return { ok: false, method: 'appone_attempted', detail: wall || 'Still on AppOne auth pages' };
}

async function completeAppOneSecurityQuestion(driver: WebDriver): Promise<boolean> {
  const url = (await driver.getCurrentUrl()).toLowerCase();
  const body = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 2000);'
  )) as string) || '';
  if (!/securityquestion|security question/i.test(`${url}\n${body}`)) return false;

  const answer = config.apply.portalSecurityAnswer || 'LongBeachCA';
  const ok = (await driver.executeScript(
    `
    const answer = arguments[0];
    function nativeSet(el, v) {
      if (!el) return;
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      desc.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const selects = Array.from(document.querySelectorAll('select'));
    let picked = false;
    for (const sel of selects) {
      const opts = Array.from(sel.options || []);
      const choice =
        opts.find((o) => /favorite|birth|movie|food|car|restaurant|mother|school/i.test(o.text || '')) ||
        opts.find((o) => (o.value || '') && !/none selected|select/i.test(o.text || ''));
      if (choice) {
        sel.value = choice.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        picked = true;
        break;
      }
    }
    const answerInput =
      document.querySelector('input[id*="Answer" i], input[name*="Answer" i], input[id*="txtAnswer"], textarea[id*="Answer" i]') ||
      Array.from(document.querySelectorAll('input[type="text"]')).find((el) => el.offsetParent !== null);
    nativeSet(answerInput, answer);
    const btn =
      document.getElementById('ucButtons_btnSubmit') ||
      document.querySelector('input[name*="btnSubmit"], input[value="Continue"], button[type="submit"]');
    if (btn) btn.click();
    return !!(picked && answerInput);
    `,
    answer
  )) as boolean;
  await driver.sleep(3000);
  return ok;
}

async function visibleInputs(driver: WebDriver): Promise<WebElement[]> {
  const els = await driver.findElements(
    By.css('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])')
  );
  const out: WebElement[] = [];
  for (const el of els) {
    try {
      if (await el.isDisplayed()) out.push(el);
    } catch {
      // skip
    }
  }
  return out;
}

async function fillMatchingInputs(
  driver: WebDriver,
  matcher: (meta: string, type: string) => boolean,
  value: string
): Promise<number> {
  let n = 0;
  for (const el of await visibleInputs(driver)) {
    try {
      const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
      const meta = [
        await el.getAttribute('name'),
        await el.getAttribute('id'),
        await el.getAttribute('placeholder'),
        await el.getAttribute('aria-label'),
        await el.getAttribute('autocomplete'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!matcher(meta, type)) continue;
      await el.clear();
      await el.sendKeys(value);
      n += 1;
    } catch {
      // skip
    }
  }
  return n;
}

async function clickAuthButton(driver: WebDriver, kind: 'signup' | 'login' | 'any'): Promise<boolean> {
  const clicked = (await driver.executeScript(
    `
    const kind = arguments[0];
    function visible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && el.offsetParent !== null;
    }
    const nodes = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]'));
    let best = null;
    let bestScore = -1;
    for (const el of nodes) {
      if (!visible(el)) continue;
      const text = ((el.innerText || el.value || el.getAttribute('aria-label') || '') + '')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (!text || text.length > 60) continue;
      let score = 0;
      if (kind === 'signup' || kind === 'any') {
        if (/create (an )?account|sign up|register|new account/.test(text)) score += 50;
      }
      if (kind === 'login' || kind === 'any') {
        if (/^sign in$|^log in$|sign in|log in|login/.test(text)) score += 40;
      }
      if (/continue|next|submit|apply/.test(text)) score += 15;
      if (/forgot|help|privacy|terms|google|linkedin|facebook/.test(text)) score -= 40;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (!best || bestScore < 15) return false;
    best.click();
    return true;
    `,
    kind
  )) as boolean;
  return !!clicked;
}

/**
 * Workday / generic portals require "I Agree to these Terms…" before Create Account.
 * Handles native checkboxes and Workday [role=checkbox] widgets.
 */
export async function checkAgreeTermsBoxes(driver: WebDriver): Promise<number> {
  // Workday stable ids first (createAccountCheckbox / agreementCheckbox)
  const workdaySelectors = [
    'input[type="checkbox"][data-automation-id="createAccountCheckbox"]',
    'input[data-automation-id="createAccountCheckbox"]',
    'input[type="checkbox"][data-automation-id="agreementCheckbox"]',
    '[data-automation-id="createAccountCheckbox"]',
    '[data-automation-id="agreementCheckbox"]',
  ];
  let checked = 0;
  for (const sel of workdaySelectors) {
    try {
      const els = await driver.findElements(By.css(sel));
      for (const el of els) {
        try {
          const tag = (await el.getTagName()).toLowerCase();
          if (tag === 'input') {
            if (await el.isSelected().catch(() => false)) continue;
          } else if (((await el.getAttribute('aria-checked')) || '').toLowerCase() === 'true') {
            continue;
          }
          await driver.executeScript(
            `
            const el = arguments[0];
            el.scrollIntoView({ block: 'center' });
            el.click();
            if (el.tagName === 'INPUT' && !el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            `,
            el
          );
          checked += 1;
        } catch {
          // next
        }
      }
    } catch {
      // next selector
    }
  }
  if (checked > 0) {
    console.log(`Portal auth: checked ${checked} Workday terms box(es)`);
    await driver.sleep(400);
    return checked;
  }

  const n = (await driver.executeScript(`
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return false;
      const st = window.getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    }
    function nearbyText(el) {
      const parts = [];
      if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
      if (el.id) {
        const lab = document.querySelector('label[for="' + el.id.replace(/"/g, '') + '"]');
        if (lab) parts.push(lab.innerText || '');
      }
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        parts.push(p.innerText || '');
        p = p.parentElement;
      }
      return parts.join(' ').replace(/\\s+/g, ' ').toLowerCase().slice(0, 400);
    }
    function isAgree(text) {
      return /i agree|agree to (these )?terms|terms and conditions|terms of use|privacy policy|acknowledge|certify|consent/.test(text)
        && !/already have an account|sign in|forgot/.test(text);
    }
    let checked = 0;
    const inputs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    for (const el of inputs) {
      if (!visible(el) && el.offsetParent === null) continue;
      if (el.checked || el.disabled) continue;
      const auto = (el.getAttribute('data-automation-id') || '').toLowerCase();
      if (!/createaccountcheckbox|agreementcheckbox|agree/.test(auto) && !isAgree(nearbyText(el))) continue;
      try {
        el.click();
        if (!el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (el.checked) checked += 1;
      } catch (e) {}
    }
    const roles = Array.from(document.querySelectorAll('[role="checkbox"], [data-automation-id*="checkbox"], [data-automation-id*="agree"]'));
    for (const el of roles) {
      if (!visible(el)) continue;
      const aria = (el.getAttribute('aria-checked') || '').toLowerCase();
      if (aria === 'true') continue;
      const text = nearbyText(el);
      if (!isAgree(text) && !/agree|terms|conditions|checkbox/.test((el.getAttribute('data-automation-id') || '').toLowerCase())) {
        const page = (document.body && document.body.innerText || '').toLowerCase();
        if (!/please check the box|i agree to these terms/.test(page)) continue;
      }
      try {
        el.click();
        checked += 1;
      } catch (e) {
        try {
          const label = el.closest('label') || el.parentElement;
          if (label) { label.click(); checked += 1; }
        } catch (e2) {}
      }
    }
    if (checked === 0) {
      const labels = Array.from(document.querySelectorAll('label, span, div'));
      for (const el of labels) {
        if (!visible(el)) continue;
        const t = ((el.innerText || '') + '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (t.length < 8 || t.length > 120) continue;
        if (!/^i agree to these terms/.test(t) && t !== 'i agree to these terms and conditions') continue;
        try {
          el.click();
          checked += 1;
          break;
        } catch (e) {}
      }
    }
    return checked;
  `)) as number;

  if (n > 0) {
    console.log(`Portal auth: checked ${n} terms/agree box(es)`);
    await driver.sleep(400);
  }
  return n || 0;
}

async function pageLooksLikeOtp(driver: WebDriver): Promise<boolean> {
  const text = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 4000);'
  )) as string).toLowerCase();
  return (
    /verification code|enter (the )?code|security code|one[- ]time|otp|authenticate|check your email|we (sent|emailed)/i.test(
      text
    ) ||
    !!(await driver.findElements(By.css('input[autocomplete="one-time-code"]'))).length
  );
}

async function fillOtp(driver: WebDriver, code: string): Promise<boolean> {
  const filled = await fillMatchingInputs(
    driver,
    (meta, type) =>
      type === 'tel' ||
      type === 'number' ||
      type === 'text' ||
      /code|otp|verif|pin|token|security/.test(meta),
    code
  );
  if (filled) return true;
  // Single visible short input fallback
  for (const el of await visibleInputs(driver)) {
    try {
      const type = ((await el.getAttribute('type')) || 'text').toLowerCase();
      if (['password', 'email', 'file', 'checkbox', 'radio'].includes(type)) continue;
      await el.clear();
      await el.sendKeys(code);
      return true;
    } catch {
      // skip
    }
  }
  return false;
}

/**
 * Open Gmail in a new tab (same Chrome profile), read a recent verification code, close tab.
 */
export async function fetchGmailVerificationCode(
  driver: WebDriver,
  options?: { waitMs?: number; afterMs?: number }
): Promise<string | null> {
  const waitMs = options?.waitMs ?? config.apply.otpWaitMs;
  const afterMs = options?.afterMs ?? Date.now() - 5 * 60_000;
  const original = await driver.getWindowHandle();
  const before = await driver.getAllWindowHandles();

  await driver.executeScript(
    'window.open(arguments[0], "_blank");',
    config.apply.gmailInboxUrl
  );
  await driver.sleep(1500);

  let gmailHandle: string | null = null;
  for (let i = 0; i < 20 && !gmailHandle; i++) {
    const after = await driver.getAllWindowHandles();
    const added = after.filter((h) => !before.includes(h));
    if (added.length) gmailHandle = added[added.length - 1];
    else await driver.sleep(250);
  }
  if (!gmailHandle) return null;

  try {
    await driver.switchTo().window(gmailHandle);
    // Search recent verification-ish mail
    const searchUrl =
      'https://mail.google.com/mail/u/0/#search/newer_than%3A2h+(verification+OR+code+OR+OTP+OR+%22security+code%22+OR+AppOne+OR+ByteDance+OR+bytedance+OR+confirm)';
    await driver.get(searchUrl);
    await driver.sleep(4000);

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const code = (await driver.executeScript(
        `
        const afterMs = arguments[0];
        function extractCode(text) {
          if (!text) return null;
          const patterns = [
            /(?:code|otp|pin|verification|security)\\s*(?:is|:)?\\s*([0-9]{4,8})/i,
            /\\b([0-9]{6})\\b/,
            /\\b([0-9]{4,8})\\b/,
          ];
          for (const re of patterns) {
            const m = text.match(re);
            if (m && m[1] && !/^(19|20)\\d{2}$/.test(m[1])) return m[1];
          }
          return null;
        }
        // Prefer open conversation body
        const body =
          document.querySelector('.a3s.aiL, .a3s, [data-message-id] .a3s') ||
          document.querySelector('[role="main"]');
        const fromBody = extractCode(body && body.innerText);
        if (fromBody) return fromBody;
        // Click first inbox row if present
        const row = document.querySelector('tr.zA, div[role="row"].zA, .zA');
        if (row) row.click();
        return null;
        `,
        afterMs
      )) as string | null;

      if (code) return code;
      await driver.sleep(2500);
      // Refresh search results periodically
      if (Date.now() % 12000 < 3000) {
        try {
          await driver.navigate().refresh();
          await driver.sleep(3000);
        } catch {
          // ignore
        }
      }
    }
    return null;
  } finally {
    try {
      const handles = await driver.getAllWindowHandles();
      if (handles.includes(gmailHandle)) {
        await driver.switchTo().window(gmailHandle);
        await driver.close();
      }
      if (handles.includes(original) || (await driver.getAllWindowHandles()).includes(original)) {
        await driver.switchTo().window(original);
      }
    } catch {
      try {
        const left = await driver.getAllWindowHandles();
        if (left.length) await driver.switchTo().window(left[0]);
      } catch {
        // ignore
      }
    }
  }
}

function pagePrefersSignup(body: string, url: string): boolean {
  const t = `${url}\n${body}`.toLowerCase();
  if (/create (an )?account|sign up|register|new applicant|new user/.test(t)) return true;
  if (/already have an account|sign in to continue/.test(t) && /create/.test(t)) return true;
  return false;
}

function isByteDanceAuthUrl(url: string): boolean {
  return /jobs\.bytedance\.com|joinbytedance\.com/i.test(url || '');
}

/**
 * ByteDance careers login:
 * 1) Prefer Sign in (email + password) when that panel is showing — no Get code there.
 * 2) Else Create account → Get code → Gmail OTP → Continue.
 */
async function tryByteDanceAccountAuth(
  driver: WebDriver,
  c: PortalCredentials
): Promise<{ ok: boolean; method: string; detail?: string } | null> {
  const url = await driver.getCurrentUrl();
  if (!isByteDanceAuthUrl(url)) return null;

  const body = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 5000);'
  )) as string) || '';

  if (!/create account|sign in|email|get code|password/i.test(body) && !/\/login/i.test(url)) {
    return null;
  }

  const checkPrivacy = async () => {
    await checkAgreeTermsBoxes(driver);
    await driver.executeScript(`
      for (const el of Array.from(document.querySelectorAll('input[type="checkbox"]'))) {
        if (el.checked || el.disabled) continue;
        el.click();
        if (!el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    `);
  };

  const setNativeFill = async (jsFinder: string, value: string) =>
    (await driver.executeScript(
      `
      const val = arguments[0];
      function setNative(el, v) {
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.focus();
        el.click();
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (desc && desc.set) { desc.set.call(el, ''); desc.set.call(el, v); }
        else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      ${jsFinder}
      `,
      value
    )) as boolean;

  // --- Path A: Sign in panel (email + password, NO Get code) ---
  const onSignIn = (await driver.executeScript(`
    const hasPass = !!document.querySelector('input[type="password"]');
    const hasGetCode = Array.from(document.querySelectorAll('button, a, span')).some((el) =>
      /^get code$/i.test(((el.innerText || '') + '').trim())
    );
    const t = (document.body.innerText || '').toLowerCase();
    return hasPass && !hasGetCode && /sign in/.test(t);
  `)) as boolean;

  if (onSignIn) {
    console.log('ByteDance auth: Sign in panel detected — using email/password');
    await setNativeFill(
      `
      const el = document.querySelector('input[placeholder="Email"], input[type="email"]') ||
        Array.from(document.querySelectorAll('input')).find((i) => /email/i.test(i.placeholder || ''));
      return setNative(el, val);
      `,
      c.email
    );
    await setNativeFill(
      `
      const el = document.querySelector('input[type="password"]');
      return setNative(el, val);
      `,
      c.password
    );
    await checkPrivacy();
    const signedIn = (await driver.executeScript(`
      const btn =
        document.querySelector('button[data-test="signInBtn"]') ||
        Array.from(document.querySelectorAll('button')).find((el) =>
          /^sign in$/i.test(((el.innerText || '') + '').trim()) && el.className.includes('primary')
        ) ||
        Array.from(document.querySelectorAll('button')).find((el) =>
          /^sign in$/i.test(((el.innerText || '') + '').trim())
        );
      if (!btn) return false;
      btn.click();
      return true;
    `)) as boolean;
    await driver.sleep(3500);
    const urlAfter = await driver.getCurrentUrl();
    const bodyAfter = ((await driver.executeScript(
      'return (document.body && document.body.innerText || "").slice(0, 3000);'
    )) as string) || '';
    if (signedIn && !/\/login(?:\?|$)/i.test(urlAfter) && !/incorrect|invalid|wrong password/i.test(bodyAfter)) {
      return { ok: true, method: 'bytedance_signin', detail: 'Signed in with email/password' };
    }
    // Account may not exist yet — fall through to Create account
    console.log('ByteDance auth: Sign in did not clear wall — trying Create account');
  }

  // --- Path B: Create account → Get code → Gmail OTP ---
  await driver.executeScript(`
    const btn = Array.from(document.querySelectorAll('button, a, [role="button"], span')).find((el) =>
      /^create account$/i.test(((el.innerText || '') + '').replace(/\\s+/g, ' ').trim())
    );
    if (btn) btn.click();
  `);

  // Wait until Get code appears (panel animation)
  let hasGetCode = false;
  for (let i = 0; i < 12; i++) {
    hasGetCode = (await driver.executeScript(`
      return Array.from(document.querySelectorAll('button, a, span, [role="button"]')).some((el) =>
        /^get code$/i.test(((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim())
      );
    `)) as boolean;
    if (hasGetCode) break;
    await driver.sleep(500);
  }

  if (!hasGetCode) {
    return {
      ok: false,
      method: 'bytedance_no_get_code',
      detail:
        'Still on Sign in (no Get code). Click Create account in Chrome, or sign in with password, then Retry.',
    };
  }

  await checkPrivacy();
  const emailFilled = await setNativeFill(
    `
    const inputs = Array.from(document.querySelectorAll('input')).filter((i) => {
      const ph = (i.placeholder || '').toLowerCase();
      const ty = (i.type || '').toLowerCase();
      if (ty === 'password' || ty === 'checkbox' || ty === 'hidden') return false;
      return ph === 'email' || ty === 'email' || /email/.test(ph);
    });
    // Prefer email near verification code field
    const codePh = Array.from(document.querySelectorAll('input')).find((i) =>
      /verification|code/i.test(i.placeholder || '')
    );
    let best = inputs[0];
    if (codePh) {
      const root = codePh.closest('form, section, div') || document.body;
      best = Array.from(root.querySelectorAll('input')).find((i) =>
        /email/i.test(i.placeholder || '') || i.type === 'email'
      ) || best;
    }
    best = inputs.find((i) => !String(i.value || '').trim()) || best || inputs[inputs.length - 1];
    return setNative(best, val);
    `,
    c.email
  );
  if (!emailFilled) {
    return { ok: false, method: 'bytedance_no_email', detail: 'Email field not found on Create account' };
  }

  const codeRequestedAt = Date.now();
  const gotCodeClick = (await driver.executeScript(`
    const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], span'));
    const btn = nodes.find((el) =>
      /^get code$/i.test(((el.innerText || el.textContent || '') + '').replace(/\\s+/g, ' ').trim())
    );
    if (!btn) return false;
    // Click the button itself, or parent button if text is in a span
    const clickable = btn.closest('button, a, [role="button"]') || btn;
    clickable.click();
    return true;
  `)) as boolean;

  if (!gotCodeClick) {
    return {
      ok: false,
      method: 'bytedance_no_get_code',
      detail: 'Create account visible but Get code click failed — finish in Chrome',
    };
  }

  console.log('ByteDance auth: clicked Get code — waiting for Gmail OTP…');
  await driver.sleep(5000);

  const code = await fetchGmailVerificationCode(driver, {
    waitMs: Math.max(config.apply.otpWaitMs, 90_000),
    afterMs: codeRequestedAt - 15_000,
  });
  if (!code) {
    return {
      ok: false,
      method: 'bytedance_otp_missing',
      detail: 'Get code clicked but no ByteDance verification email found in Gmail yet',
    };
  }

  const codeFilled = await setNativeFill(
    `
    const el = Array.from(document.querySelectorAll('input')).find((i) =>
      /verification code|enter email verification/i.test(i.placeholder || '')
    );
    return setNative(el, val);
    `,
    code
  );
  if (!codeFilled) {
    return {
      ok: false,
      method: 'bytedance_otp_field_missing',
      detail: `Got code ${code} from Gmail but could not fill verification field`,
    };
  }

  await checkPrivacy();
  await driver.executeScript(`
    const btn = Array.from(document.querySelectorAll('button')).find((el) =>
      /^(continue|create account)$/i.test(((el.innerText || '') + '').trim())
    );
    if (btn) btn.click();
  `);
  await driver.sleep(4000);

  const urlAfter = await driver.getCurrentUrl();
  const bodyAfter = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 4000);'
  )) as string) || '';

  if (/incorrect code|invalid code|try again/i.test(bodyAfter)) {
    return {
      ok: false,
      method: 'bytedance_bad_otp',
      detail: 'ByteDance rejected the verification code — Retry for a fresh Get code',
    };
  }

  if (!/\/login(?:\?|$)/i.test(urlAfter)) {
    return { ok: true, method: 'bytedance_email_otp', detail: 'Create account with Gmail OTP' };
  }

  return {
    ok: false,
    method: 'bytedance_signup_attempted',
    detail: 'Still on ByteDance login after OTP — complete sign-in in Chrome, then Retry',
  };
}

/**
 * Dedicated Workday Create Account / Sign In using data-automation-id fields.
 */
async function tryWorkdayAccountAuth(
  driver: WebDriver,
  c: PortalCredentials
): Promise<{ ok: boolean; method: string; detail?: string } | null> {
  const url = await driver.getCurrentUrl();
  if (!/myworkdayjobs\.com|workday\.com/i.test(url)) return null;

  for (let i = 0; i < 15; i++) {
    const ready = (await driver.executeScript(`
      const t = (document.body && document.body.innerText || '').trim();
      const hasAuth = !!document.querySelector(
        '[data-automation-id="email"], [data-automation-id="password"], [data-automation-id="createAccountCheckbox"], input[type="password"]'
      );
      return { tlen: t.length, hasAuth, href: location.href };
    `)) as { tlen: number; hasAuth: boolean; href: string };
    if (ready.hasAuth || ready.tlen > 80) break;
    await driver.sleep(800);
  }

  await driver.executeScript(`
    const link =
      document.querySelector('[data-automation-id="createAccountLink"], [data-automation-id="createAccountButton"]') ||
      Array.from(document.querySelectorAll('a, button, [role="button"]')).find((el) =>
        /create (an )?account|sign up/i.test((el.innerText || el.getAttribute('aria-label') || '') + '')
      );
    if (link) link.click();
  `);
  await driver.sleep(1500);

  const filled = (await driver.executeScript(
    `
    const email = arguments[0];
    const password = arguments[1];
    function setNative(el, val) {
      if (!el) return false;
      el.focus();
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const emailEl =
      document.querySelector('[data-automation-id="email"]') ||
      document.querySelector('input[type="email"]');
    const passEls = Array.from(document.querySelectorAll(
      '[data-automation-id="password"], [data-automation-id="verifyPassword"], input[type="password"]'
    ));
    let n = 0;
    if (setNative(emailEl, email)) n += 1;
    for (const p of passEls.slice(0, 2)) {
      if (setNative(p, password)) n += 1;
    }
    return n;
    `,
    c.email,
    c.password
  )) as number;

  if (!filled) {
    return { ok: false, method: 'workday_no_fields', detail: 'Workday auth fields not found yet' };
  }

  const boxes = await checkAgreeTermsBoxes(driver);

  await driver.executeScript(`
    function jsClick(el) {
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    }
    const submit =
      document.querySelector('[data-automation-id="createAccountSubmitButton"]') ||
      document.querySelector('button[data-automation-id="createAccountSubmitButton"]') ||
      document.querySelector('[aria-label="Create Account"]') ||
      document.querySelector('[data-automation-id="signInSubmitButton"]') ||
      Array.from(document.querySelectorAll('button, [role="button"], div[data-automation-id="click_filter"]'))
        .find((el) => /create account|sign in|^log in$/i.test((el.innerText || el.getAttribute('aria-label') || '') + ''));
    return jsClick(submit);
  `);
  await driver.sleep(3500);

  const body = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 5000);'
  )) as string) || '';
  if (/please check the box|agree to these terms/i.test(body)) {
    await checkAgreeTermsBoxes(driver);
    await driver.executeScript(`
      const submit =
        document.querySelector('[data-automation-id="createAccountSubmitButton"]') ||
        document.querySelector('[aria-label="Create Account"]');
      if (submit) submit.click();
    `);
    await driver.sleep(3000);
  }

  if (await pageLooksLikeOtp(driver)) {
    const code = await fetchGmailVerificationCode(driver);
    if (!code) {
      return {
        ok: false,
        method: 'workday_otp_missing',
        detail: 'Workday asked for email verification; no Gmail code yet',
      };
    }
    await fillOtp(driver, code);
    await clickAuthButton(driver, 'any');
    await driver.sleep(2500);
  }

  const urlAfter = await driver.getCurrentUrl();
  const bodyAfter = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 4000);'
  )) as string) || '';
  const stillCreate =
    /create account|please check the box|i agree to these terms/i.test(bodyAfter) &&
    /password/i.test(bodyAfter);
  if (!stillCreate && !/about:blank/i.test(urlAfter)) {
    return {
      ok: true,
      method: 'workday_signup',
      detail: boxes ? `Checked terms + submitted (${boxes} box)` : 'Submitted Workday auth',
    };
  }

  return {
    ok: false,
    method: 'workday_signup_attempted',
    detail: stillCreate
      ? 'Still on Create Account (terms/email verification may remain)'
      : 'Workday page still looks like an account wall',
  };
}

/**
 * Attempt login or sign-up on the current account-wall page.
 * Reuses the same credentials for every portal. Fetches Gmail OTP when asked.
 */
export async function tryPortalAccountAuth(
  driver: WebDriver,
  creds?: PortalCredentials | null
): Promise<{ ok: boolean; method: string; detail?: string }> {
  const c = creds ?? getPortalCredentials();
  if (!c) {
    return {
      ok: false,
      method: 'no_creds',
      detail: 'Set APPLY_PORTAL_EMAIL and APPLY_PORTAL_PASSWORD in backend/.env',
    };
  }

  const url = await driver.getCurrentUrl();
  const body = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 6000);'
  )) as string) || '';

  // AppOne has a dedicated multi-step flow (email → username/password registration).
  if (/appone\.com/i.test(url)) {
    const appone = await tryAppOneAuth(driver, c);
    if (appone) return appone;
  }

  // ByteDance: email + Get code (Gmail OTP) before application form
  if (isByteDanceAuthUrl(url) || /get code|email verification code/i.test(body)) {
    const bd = await tryByteDanceAccountAuth(driver, c);
    if (bd) return bd;
  }

  // Workday Create Account (terms checkbox + automation ids)
  if (/myworkdayjobs\.com|workday\.com/i.test(url)) {
    const wd = await tryWorkdayAccountAuth(driver, c);
    if (wd) return wd;
  }

  if (await pageLooksLikeOtp(driver)) {
    const code = await fetchGmailVerificationCode(driver);
    if (!code) return { ok: false, method: 'otp_missing', detail: 'No verification code found in Gmail' };
    await fillOtp(driver, code);
    await clickAuthButton(driver, 'any');
    await driver.sleep(2500);
    return {
      ok: !(await pageLooksLikeOtp(driver)),
      method: 'otp',
      detail: 'Filled Gmail verification code',
    };
  }

  const signup = pagePrefersSignup(body, url);
  // Prefer Create Account tab/link first when present
  if (signup) {
    await driver.executeScript(`
      const nodes = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="button"]'));
      for (const el of nodes) {
        const t = ((el.innerText || '') + '').toLowerCase();
        if (/create (an )?account|sign up|register/.test(t) && !/already/.test(t)) {
          el.click();
          return true;
        }
      }
      return false;
    `);
    await driver.sleep(1200);
  }

  const emailN = await fillMatchingInputs(
    driver,
    (meta, type) => type === 'email' || /e-?mail|username|user name|login/.test(meta),
    c.email
  );
  const passN = await fillMatchingInputs(
    driver,
    (meta, type) => type === 'password' || /password|passwd|pwd/.test(meta),
    c.password
  );

  if (!emailN && !passN) {
    return { ok: false, method: 'no_fields', detail: 'No email/password fields found' };
  }

  // Workday Create Account blocks without terms checkbox
  await checkAgreeTermsBoxes(driver);

  const clicked = await clickAuthButton(driver, signup ? 'signup' : 'login');
  if (!clicked) {
    // Try Enter on password field
    try {
      const passes = await driver.findElements(By.css('input[type="password"]'));
      for (const p of passes) {
        if (await p.isDisplayed()) {
          await p.sendKeys(Key.ENTER);
          break;
        }
      }
    } catch {
      // ignore
    }
  }
  await driver.sleep(2500);

  // Retry once if terms checkbox error appeared
  const bodyTerms = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 4000);'
  )) as string) || '';
  if (/please check the box|agree to these terms|must agree|accept the terms/i.test(bodyTerms)) {
    const n = await checkAgreeTermsBoxes(driver);
    if (n > 0) {
      await clickAuthButton(driver, signup ? 'signup' : 'any');
      await driver.sleep(2500);
    }
  }

  // Login failed → try signup path once
  const body2 = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 6000);'
  )) as string) || '';
  const stillWall =
    /invalid|incorrect|not found|doesn't exist|does not exist|create (an )?account|sign up/i.test(
      body2
    ) && /password|email|sign/i.test(body2);

  if (stillWall && !signup) {
    await driver.executeScript(`
      const nodes = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="button"]'));
      for (const el of nodes) {
        const t = ((el.innerText || '') + '').toLowerCase();
        if (/create (an )?account|sign up|register/.test(t)) { el.click(); return true; }
      }
      return false;
    `);
    await driver.sleep(1200);
    await fillMatchingInputs(
      driver,
      (meta, type) => type === 'email' || /e-?mail|username/.test(meta),
      c.email
    );
    await fillMatchingInputs(
      driver,
      (meta, type) => type === 'password' || /password/.test(meta),
      c.password
    );
    await checkAgreeTermsBoxes(driver);
    await clickAuthButton(driver, 'signup');
    await driver.sleep(3000);
  }

  if (await pageLooksLikeOtp(driver)) {
    const code = await fetchGmailVerificationCode(driver);
    if (!code) {
      return {
        ok: false,
        method: signup ? 'signup_otp_missing' : 'login_otp_missing',
        detail: 'Portal asked for a code but none was found in Gmail yet',
      };
    }
    await fillOtp(driver, code);
    await clickAuthButton(driver, 'any');
    await driver.sleep(2500);
  }

  const urlAfter = await driver.getCurrentUrl();
  const bodyAfter = ((await driver.executeScript(
    'return (document.body && document.body.innerText || "").slice(0, 4000);'
  )) as string) || '';
  const wall = detectAccountWall(urlAfter, bodyAfter);
  if (!wall) {
    return {
      ok: true,
      method: signup ? 'signup' : 'login',
      detail: 'Account wall cleared',
    };
  }

  // Soft success if we at least submitted credentials (user may need CAPTCHA)
  return {
    ok: false,
    method: signup ? 'signup_attempted' : 'login_attempted',
    detail: wall,
  };
}
