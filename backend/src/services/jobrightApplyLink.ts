/**
 * Resolve Jobright "Apply Now" → real employer career / ATS URL.
 *
 * Jobright UI (chunk 94621): window.open(jobResult.applyLink || jobResult.originalUrl, "_blank")
 * Listing SSR often leaves applyLink as a jobright.ai URL — the live button opens the external site.
 */
import { By, WebDriver } from 'selenium-webdriver';

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
      'jr_id',
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
  // Prefer class match — Jobright uses index_applyButton* for both
  // "APPLY NOW" and "APPLY WITH AUTOFILL".
  const xpaths = [
    '//*[contains(@class, "applyButton") and (self::button or self::a)]',
    '//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "apply with autofill")]',
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

/**
 * Click Jobright Apply Now and capture the employer career/ATS URL from the new tab.
 * Leaves the driver on the original Jobright tab.
 */
export async function resolveJobrightCareerUrl(
  driver: WebDriver,
  options?: { waitMs?: number }
): Promise<{ careerUrl: string | null; method: string }> {
  const waitMs = options?.waitMs ?? 8000;

  const fromData = await readNextDataCareerUrl(driver);
  if (fromData) {
    return { careerUrl: normalizeCareerApplyUrl(fromData), method: 'next_data' };
  }

  // Sometimes Apply Now is already an <a href="https://…">
  try {
    const href = (await driver.executeScript(`
      const nodes = [...document.querySelectorAll('a[href], button, [role="button"]')];
      for (const n of nodes) {
        const text = (n.innerText || n.textContent || '').toLowerCase();
        if (!text.includes('apply')) continue;
        const href = n.href || n.getAttribute('href') || '';
        if (href && /^https?:/i.test(href) && !/jobright\\.ai/i.test(href)) return href;
      }
      return null;
    `)) as string | null;
    if (href && isExternalCareerUrl(href)) {
      return { careerUrl: normalizeCareerApplyUrl(href), method: 'anchor_href' };
    }
  } catch {
    // continue to click path
  }

  const before = await driver.getAllWindowHandles();
  const original = await driver.getWindowHandle();
  const btn = await findApplyNowElement(driver);
  if (!btn) {
    return { careerUrl: null, method: 'no_button' };
  }

  try {
    await driver.executeScript('arguments[0].scrollIntoView({block:"center"});', btn);
    await driver.sleep(400);
    // JS click first — Ant Design / React handlers reliably open window.open;
    // native Selenium click often no-ops on these buttons.
    try {
      await driver.executeScript('arguments[0].click();', btn);
    } catch {
      await btn.click();
    }
  } catch (err) {
    console.warn('Jobright Apply Now click failed:', err);
    return { careerUrl: null, method: 'click_failed' };
  }

  const deadline = Date.now() + waitMs;
  let newHandle: string | null = null;
  while (Date.now() < deadline && !newHandle) {
    const after = await driver.getAllWindowHandles();
    const added = after.filter((h) => !before.includes(h));
    if (added.length) {
      newHandle = added[added.length - 1];
      break;
    }
    await driver.sleep(250);
  }

  if (!newHandle) {
    // Same-tab navigation fallback
    const current = (await driver.getCurrentUrl()).split('#')[0];
    if (isExternalCareerUrl(current)) {
      return { careerUrl: normalizeCareerApplyUrl(current), method: 'same_tab_nav' };
    }
    return { careerUrl: null, method: 'no_new_tab' };
  }

  try {
    await driver.switchTo().window(newHandle);
    // Wait for redirect to settle past about:blank / jobright interstitial
    const settleUntil = Date.now() + waitMs;
    let careerUrl: string | null = null;
    while (Date.now() < settleUntil) {
      const url = (await driver.getCurrentUrl()).split('#')[0];
      if (isExternalCareerUrl(url)) {
        careerUrl = normalizeCareerApplyUrl(url);
        break;
      }
      await driver.sleep(300);
    }
    await driver.close();
    await driver.switchTo().window(original);
    return {
      careerUrl,
      method: careerUrl ? 'apply_now_tab' : 'new_tab_not_external',
    };
  } catch (err) {
    try {
      const handles = await driver.getAllWindowHandles();
      if (handles.includes(original)) await driver.switchTo().window(original);
    } catch {
      // ignore
    }
    console.warn('Jobright Apply Now tab capture failed:', err);
    return { careerUrl: null, method: 'tab_error' };
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
