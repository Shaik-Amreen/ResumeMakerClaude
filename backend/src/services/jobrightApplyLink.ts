/**
 * Resolve Jobright "Apply With Autofill" → real employer career / ATS URL.
 *
 * Jobright UI: plain click often stays on Jobright autofill / internal detail.
 * Ctrl/Cmd+click (or window.open of applyLink/originalUrl) opens the external career page.
 */
import { By, Key, WebDriver, WebElement } from 'selenium-webdriver';

const JOBRIGHT_HOST = /(?:^|\.)jobright\.ai$/i;

export function isJobrightUrl(url: string): boolean {
  try {
    return JOBRIGHT_HOST.test(new URL(url).hostname);
  } catch {
    return /jobright\.ai/i.test(url || '');
  }
}

export function extractJobrightJobId(url: string): string | null {
  const m = (url || '').match(/jobright\.ai\/jobs\/info\/([a-f0-9]+)/i);
  return m?.[1] || null;
}

/** Noise hosts that are never a career/ATS apply target. */
function isBlockedNoiseHost(host: string): boolean {
  const h = host.toLowerCase();
  // Use host-boundary checks — bare /x\.com/ falsely matches paychex.com
  if (h === 'x.com' || h.endsWith('.x.com')) return true;
  if (/(^|\.)(google|gstatic|googleapis|facebook|twitter|licdn|crunchbase)\./.test(h)) {
    return true;
  }
  if (h.includes('recaptcha')) return true;
  return false;
}

/** True when a URL is usable as an external career/ATS apply target. */
export function isExternalCareerUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (isJobrightUrl(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (isBlockedNoiseHost(host)) return false;
    // Company pages / home — not an application form. Job links may still be kept.
    if (host.includes('linkedin.com') && /\/company(\/|$)/.test(path)) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Clean career/ATS URLs for storage without dropping job-id query params
 * (e.g. Paychex R_ID). Only strips hash + common tracking.
 */
export function normalizeCareerApplyUrl(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
    ]) {
      u.searchParams.delete(key);
    }
    // Truncated Jobright tracking sometimes leaves bare `j`
    if (u.searchParams.get('j') === '' || u.searchParams.get('j') === 'null') {
      u.searchParams.delete('j');
    }
    // Simplify/XML scrapers sometimes prefix years as XMLNAME-2026 → 2026
    u.pathname = u.pathname.replace(/XMLNAME-/gi, '');
    let out = u.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    if (!u.search && /\/$/.test(u.pathname) && u.pathname.length > 1) {
      out = out.replace(/\/$/, '');
    }
    return out;
  } catch {
    return (url.split('#')[0] || '').replace(/XMLNAME-/gi, '');
  }
}

/**
 * Normalize the stored job URL used by "View on …" and career apply.
 * Always prefer this over navigating to about:blank / LinkedIn seed pages.
 */
export function sanitizeStoredJobUrl(url: string): string {
  return normalizeCareerApplyUrl((url || '').trim());
}

/**
 * Prefer external applyLink/originalUrl from __NEXT_DATA__ when present.
 * Falls back to null when SSR only has jobright.ai links.
 */
export function parseJobrightCareerUrlFromNextData(htmlOrJson: string): string | null {
  const raw = htmlOrJson || '';
  let jsonText = raw;
  const script = raw.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (script?.[1]) jsonText = script[1];

  try {
    const data = JSON.parse(jsonText) as {
      props?: { pageProps?: { dataSource?: { jobResult?: Record<string, unknown> } } };
    };
    const jr = data?.props?.pageProps?.dataSource?.jobResult;
    if (!jr) return null;
    for (const key of ['originalUrl', 'applyLink', 'applyUrl', 'jobUrl']) {
      const val = jr[key];
      if (typeof val === 'string' && isExternalCareerUrl(val)) return val.split('#')[0];
    }
  } catch {
    // not JSON / incomplete
  }

  // Regex fallback if JSON parse fails on a partial blob
  for (const key of ['originalUrl', 'applyLink']) {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"(https?:\\\\/\\\\/[^"]+)"`, 'i'))
      || raw.match(new RegExp(`"${key}"\\s*:\\s*"(https?://[^"]+)"`, 'i'));
    if (m?.[1]) {
      const url = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
      if (isExternalCareerUrl(url)) return url.split('#')[0];
    }
  }
  return null;
}

async function readNextDataCareerUrl(driver: WebDriver): Promise<string | null> {
  try {
    const html = (await driver.executeScript(`
      const el = document.getElementById('__NEXT_DATA__');
      return el ? el.textContent : document.documentElement.outerHTML.slice(0, 500000);
    `)) as string;
    return parseJobrightCareerUrlFromNextData(html || '');
  } catch {
    return null;
  }
}

async function findApplyNowElement(driver: WebDriver) {
  // Prefer "APPLY WITH AUTOFILL" — Ctrl/Cmd+click opens the real career portal.
  // Generic applyButton class also matches APPLY NOW (Jobright-internal autofill).
  const xpaths = [
    '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply with autofill")]',
    '//*[contains(@class, "applyButton") and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "autofill")]',
    '//a[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply with autofill")]',
    '//*[contains(@class, "applyButton") and (self::button or self::a)]',
    '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply now")]',
    '//button[.//span[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply now")]]',
    '//a[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply now")]',
    '//button[contains(., "Apply on Employer")]',
    '//*[contains(text(), "Apply on Employer Site")]/ancestor::button[1]',
  ];
  for (const xpath of xpaths) {
    const els = await driver.findElements(By.xpath(xpath));
    for (const el of els) {
      try {
        if (await el.isDisplayed()) return el;
      } catch {
        // try next
      }
    }
  }
  return null;
}

/** Install hooks so we can read the URL Jobright passes to window.open / <a target=_blank>. */
async function installOpenCapture(driver: WebDriver): Promise<void> {
  await driver.executeScript(`
    (function () {
      if (window.__jrOpenHookInstalled) return;
      window.__jrOpenHookInstalled = true;
      window.__jrCapturedOpens = [];
      const push = (url) => {
        if (!url || typeof url !== 'string') return;
        window.__jrCapturedOpens.push(String(url));
      };
      const origOpen = window.open.bind(window);
      window.open = function (url, name, specs) {
        push(url);
        try { return origOpen(url, name, specs); } catch (e) {
          try { return origOpen(url, '_blank'); } catch (_) { return null; }
        }
      };
      document.addEventListener('click', function (ev) {
        const t = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (t && t.href) push(t.href);
      }, true);
    })();
  `);
}

async function readCapturedOpens(driver: WebDriver): Promise<string[]> {
  try {
    const urls = (await driver.executeScript(`
      return Array.isArray(window.__jrCapturedOpens) ? window.__jrCapturedOpens.slice() : [];
    `)) as string[];
    return Array.isArray(urls) ? urls : [];
  } catch {
    return [];
  }
}

function firstExternalFromList(urls: string[]): string | null {
  for (const raw of urls) {
    const cleaned = normalizeCareerApplyUrl((raw || '').split('#')[0]);
    if (isExternalCareerUrl(cleaned)) return cleaned;
  }
  return null;
}

/**
 * Ctrl/Cmd+click APPLY WITH AUTOFILL — Jobright opens the employer career page in a new tab.
 * Plain click often stays on Jobright's internal autofill / detail flow.
 */
async function modifierClickApply(driver: WebDriver, btn: WebElement): Promise<string> {
  await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', btn);
  await driver.sleep(350);

  // Preferred: synthetic click with both modifiers (works on Mac + Windows).
  try {
    await driver.executeScript(
      `
      const el = arguments[0];
      const opts = { bubbles: true, cancelable: true, view: window, ctrlKey: true, metaKey: true, button: 0 };
      el.dispatchEvent(new MouseEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      `,
      btn
    );
    return 'modifier_js';
  } catch {
    // fall through
  }

  // Selenium chord: COMMAND on macOS, CONTROL elsewhere.
  try {
    const mod = process.platform === 'darwin' ? Key.COMMAND : Key.CONTROL;
    await driver.actions({ async: true }).keyDown(mod).click(btn).keyUp(mod).perform();
    return 'modifier_actions';
  } catch {
    // last resort: plain click (may only open Jobright autofill)
    try {
      await driver.executeScript('arguments[0].click();', btn);
    } catch {
      await btn.click();
    }
    return 'plain_click';
  }
}

async function captureUrlFromNewTab(
  driver: WebDriver,
  original: string,
  before: string[],
  waitMs: number
): Promise<{ careerUrl: string | null; method: string }> {
  const deadline = Date.now() + waitMs;
  let newHandle: string | null = null;
  while (Date.now() < deadline && !newHandle) {
    const captured = firstExternalFromList(await readCapturedOpens(driver));
    if (captured) {
      // Close any extra tabs Jobright opened, stay on original.
      const afterEarly = await driver.getAllWindowHandles();
      for (const h of afterEarly) {
        if (h === original) continue;
        try {
          await driver.switchTo().window(h);
          await driver.close();
        } catch {
          // ignore
        }
      }
      try {
        await driver.switchTo().window(original);
      } catch {
        // ignore
      }
      return { careerUrl: captured, method: 'window_open_hook' };
    }

    const after = await driver.getAllWindowHandles();
    const added = after.filter((h) => !before.includes(h));
    if (added.length) {
      newHandle = added[added.length - 1];
      break;
    }
    await driver.sleep(250);
  }

  if (!newHandle) {
    const current = (await driver.getCurrentUrl()).split('#')[0];
    if (isExternalCareerUrl(current)) {
      return { careerUrl: normalizeCareerApplyUrl(current), method: 'same_tab_nav' };
    }
    return { careerUrl: null, method: 'no_new_tab' };
  }

  try {
    await driver.switchTo().window(newHandle);
    const settleUntil = Date.now() + waitMs;
    let careerUrl: string | null = null;
    while (Date.now() < settleUntil) {
      const url = (await driver.getCurrentUrl()).split('#')[0];
      if (isExternalCareerUrl(url)) {
        careerUrl = normalizeCareerApplyUrl(url);
        break;
      }
      // Jobright sometimes lands on an interstitial then redirects
      await driver.sleep(300);
    }
    await driver.close();
    await driver.switchTo().window(original);
    return {
      careerUrl,
      method: careerUrl ? 'autofill_modclick_tab' : 'new_tab_not_external',
    };
  } catch (err) {
    try {
      const handles = await driver.getAllWindowHandles();
      if (handles.includes(original)) await driver.switchTo().window(original);
    } catch {
      // ignore
    }
    console.warn('Jobright Apply Autofill tab capture failed:', err);
    return { careerUrl: null, method: 'tab_error' };
  }
}

/**
 * Resolve Jobright "APPLY WITH AUTOFILL" → employer career / ATS URL.
 * Prefer Ctrl/Cmd+click (opens real career page); plain click often stays on Jobright.
 * Leaves the driver on the original Jobright tab.
 */
export async function resolveJobrightCareerUrl(
  driver: WebDriver,
  options?: { waitMs?: number }
): Promise<{ careerUrl: string | null; method: string }> {
  const waitMs = options?.waitMs ?? 12000;

  const fromData = await readNextDataCareerUrl(driver);
  if (fromData) {
    return { careerUrl: normalizeCareerApplyUrl(fromData), method: 'next_data' };
  }

  // Live page may expose external href after hydration
  try {
    const href = (await driver.executeScript(`
      const nodes = [...document.querySelectorAll('a[href], button, [role="button"]')];
      for (const n of nodes) {
        const text = (n.innerText || n.textContent || '').toLowerCase();
        if (!/apply/.test(text)) continue;
        const href = n.href || n.getAttribute('href') || '';
        if (href && /^https?:/i.test(href) && !/jobright\\.ai/i.test(href)) return href;
      }
      return null;
    `)) as string | null;
    if (href && isExternalCareerUrl(href)) {
      return { careerUrl: normalizeCareerApplyUrl(href), method: 'anchor_href' };
    }
  } catch {
    // continue
  }

  const before = await driver.getAllWindowHandles();
  const original = await driver.getWindowHandle();
  const btn = await findApplyNowElement(driver);
  if (!btn) {
    return { careerUrl: null, method: 'no_button' };
  }

  try {
    await installOpenCapture(driver);
    const clickMethod = await modifierClickApply(driver, btn);
    const captured = await captureUrlFromNewTab(driver, original, before, waitMs);
    if (captured.careerUrl) {
      return {
        careerUrl: captured.careerUrl,
        method: `${clickMethod}+${captured.method}`,
      };
    }
    // If modifier click failed to open external URL, try one plain click as last resort
    if (clickMethod !== 'plain_click') {
      const before2 = await driver.getAllWindowHandles();
      try {
        await driver.executeScript('arguments[0].click();', btn);
      } catch {
        await btn.click();
      }
      const second = await captureUrlFromNewTab(driver, original, before2, Math.min(waitMs, 8000));
      if (second.careerUrl) {
        return { careerUrl: second.careerUrl, method: `plain_fallback+${second.method}` };
      }
      return { careerUrl: null, method: second.method };
    }
    return { careerUrl: null, method: captured.method };
  } catch (err) {
    console.warn('Jobright Apply Autofill resolve failed:', err);
    return { careerUrl: null, method: 'click_failed' };
  }
}

/**
 * Enrich JD text from the Jobright detail pane (employer JD is shown there).
 */
export async function readJobrightJdText(driver: WebDriver): Promise<string> {
  return (await driver.executeScript(`
    const selectors = [
      '[class*="jobDescription"]',
      '[class*="JobDescription"]',
      '[class*="jdContent"]',
      'main',
      '[class*="detail"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = (el && el.innerText || '').trim();
      if (t.length > 400) return t.slice(0, 20000);
    }
    return (document.body.innerText || '').slice(0, 20000);
  `)) as string;
}
