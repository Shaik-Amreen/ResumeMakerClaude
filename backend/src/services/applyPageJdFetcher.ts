import { WebDriver } from 'selenium-webdriver';
import { attachDriver, releaseDriver } from './chromeProfile';
import { config } from '../config';
import { scrapeSleep } from './scrapeContext';
import { logScrapingUrl } from './taskStatusService';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeJsString(s: string): string {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) return '';
  return res.text();
}

async function fetchGreenhouseOrLever(url: string): Promise<string> {
  const gh = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([^/?&#]+)\/jobs\/(\d+)/i)
    || url.match(/job-boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
  if (gh) {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${gh[1]}/jobs/${gh[2]}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (job-tracker)' } }
    );
    if (res.ok) {
      const data = (await res.json()) as { content?: string };
      if (data.content) return stripHtml(data.content);
    }
  }

  const lever = url.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/i);
  if (lever) {
    const res = await fetch(
      `https://api.lever.co/v0/postings/${lever[1]}/${lever[2]}?mode=json`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (job-tracker)' } }
    );
    if (res.ok) {
      const data = (await res.json()) as { descriptionPlain?: string; description?: string };
      if (data.descriptionPlain) return data.descriptionPlain.trim();
      if (data.description) return stripHtml(data.description);
    }
  }

  const ashby = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([a-f0-9-]+)/i);
  if (ashby) {
    // Ashby public posting page often embeds JSON; fall through to HTML parser.
  }

  return '';
}

function extractAppleJdFromHtml(html: string): string {
  if (!/jobs\.apple\.com|careers at apple/i.test(html) && !/jobSummary/.test(html)) return '';

  const fields = ['postingTitle', 'jobSummary', 'description', 'minQualifications', 'preferredQualifications', 'education'];
  const parts: string[] = [];
  for (const field of fields) {
    const m = html.match(new RegExp(`\\\\"${field}\\\\":\\\\"(.*?)\\\\"`, 's'));
    if (m?.[1]) {
      const val = decodeJsString(m[1]).trim();
      if (val) parts.push(field === 'postingTitle' ? val : `${field}:\n${val}`);
    }
  }
  return parts.join('\n\n').trim();
}

function extractJsonLdJobPosting(html: string): string {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const graph = item['@graph'] || [item];
        for (const node of graph) {
          if (!node || node['@type'] !== 'JobPosting') continue;
          const desc = stripHtml(String(node.description || ''));
          const title = String(node.title || '');
          if (desc.length > 80) return [title, desc].filter(Boolean).join('\n\n');
        }
      }
    } catch {
      // ignore
    }
  }
  return '';
}

function extractGenericHtmlJd(html: string): string {
  // Dead posting / ATS 404 shells — do not scrape chrome as a JD
  if (
    /job not found|the job you requested was not found|this (?:job|position|posting) (?:is )?(?:no longer|not) available|page not found|position has been filled/i.test(
      html
    )
  ) {
    return '';
  }

  const apple = extractAppleJdFromHtml(html);
  if (apple.length > 120 && !isInvalidOrMissingJd(apple)) return apple;

  const ld = extractJsonLdJobPosting(html);
  if (ld.length > 120 && !isInvalidOrMissingJd(ld)) return ld;

  // Main / article body heuristics
  const main =
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ||
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ||
    html.match(/id=["'][^"']*job[^"']*description[^"']*["'][\s\S]{200,20000}/i)?.[0] ||
    '';
  const text = stripHtml(main || html);
  if (text.length < 200) return '';
  // Drop obvious chrome
  const cleaned = text
    .replace(/cookie|privacy policy|sign in|create account/gi, ' ')
    .slice(0, 12000)
    .trim();
  if (cleaned.length < 200 || isInvalidOrMissingJd(cleaned)) return '';
  return cleaned;
}

async function fetchJdWithSelenium(
  url: string,
  existingDriver?: WebDriver | null
): Promise<{ text: string; driver: WebDriver | null }> {
  let driver = existingDriver || null;
  let created = false;
  try {
    if (!driver) {
      const { linkedin } = config;
      driver = await attachDriver({
        kind: 'orange',
        userDataDir: linkedin.userDataDir,
        profileDirectory: linkedin.profileDirectory,
        debugPort: linkedin.debugPort,
        headless: linkedin.headless,
        startUrl: url,
      });
      created = true;
    }
    logScrapingUrl(url, 'Fetch JD');
    await driver.get(url);
    // Wait for SPA hydrate so JD text matches the real posting.
    try {
      await driver.wait(async () => {
        const state = (await driver!.executeScript(`
          return {
            ready: document.readyState,
            len: (document.body && document.body.innerText || '').trim().length
          };
        `)) as { ready: string; len: number };
        return state.ready === 'complete' && state.len > 400;
      }, 15000);
    } catch {
      // Fall through — still attempt extract after grace period.
    }
    await scrapeSleep(2500);
    const text = (await driver.executeScript(`
      const pick = () => {
        const sels = [
          '[data-test="job-description"]',
          '#job-description',
          '.job-description',
          '[class*="JobDescription"]',
          'main',
          'article',
          '[role="main"]'
        ];
        for (const s of sels) {
          const el = document.querySelector(s);
          const t = (el && el.innerText || '').trim();
          if (t && t.length > 200) return t;
        }
        return (document.body && document.body.innerText || '').trim();
      };
      return pick().slice(0, 14000);
    `)) as string;
    return { text: (text || '').trim(), driver };
  } catch (err) {
    console.warn(`Selenium JD fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    if (created) {
      await releaseDriver(driver);
      driver = null;
    }
    return { text: '', driver };
  }
}

export type JdFetchSession = { driver: WebDriver | null };

/**
 * Visit an apply URL and return the real job description text.
 * Never invents a placeholder — returns '' if the page cannot be read.
 */
export async function fetchJobDescriptionFromApplyUrl(
  url: string,
  opts?: { allowSelenium?: boolean; session?: JdFetchSession }
): Promise<string> {
  if (!url || !/^https?:\/\//i.test(url)) return '';

  const accept = (text: string) => {
    const t = (text || '').trim();
    if (t.length < 200) return '';
    if (isInvalidOrMissingJd(t)) return '';
    return t;
  };

  try {
    const fromApi = await fetchGreenhouseOrLever(url);
    const ok = accept(fromApi);
    if (ok) return ok;
  } catch {
    // continue
  }

  try {
    const html = await fetchText(url);
    if (html) {
      const fromHtml = extractGenericHtmlJd(html);
      const ok = accept(fromHtml);
      if (ok) return ok;
    }
  } catch (err) {
    console.warn(`HTTP JD fetch failed for ${url}:`, err instanceof Error ? err.message : err);
  }

  if (opts?.allowSelenium !== false) {
    const { text, driver } = await fetchJdWithSelenium(url, opts?.session?.driver);
    if (opts?.session) opts.session.driver = driver;
    const ok = accept(text);
    if (ok) return ok;
  }

  return '';
}

export async function closeJdFetchSession(session?: JdFetchSession) {
  if (session?.driver) {
    await releaseDriver(session.driver);
    session.driver = null;
  }
}

/**
 * True when text is a dead posting / ATS chrome / placeholder — not a real JD.
 * Used to skip GitHub-list apply links that open "Job not found" Workday pages.
 */
export function isInvalidOrMissingJd(text: string): boolean {
  const raw = (text || '').trim();
  const t = raw.replace(/\s+/g, ' ');
  if (t.length < 200) return true;

  if (
    /\bjob not found\b/i.test(t) ||
    /\bthe job you requested was not found\b/i.test(t) ||
    /\bthis (?:job|position|posting|opportunity) (?:is )?(?:no longer|not) available\b/i.test(t) ||
    /\bthat listing is no longer valid\b/i.test(t) ||
    /\bthis position has been filled\b/i.test(t) ||
    /\bpage not found\b/i.test(t) ||
    /\bview all open positions\b/i.test(t) ||
    /\bno longer accepting applications\b/i.test(t) ||
    /\bposting has been (?:removed|closed|expired)\b/i.test(t) ||
    /\bopportunity has expired\b/i.test(t) ||
    /\bwe couldn'?t find (?:this|that|the) (?:job|page|posting)\b/i.test(t)
  ) {
    return true;
  }

  // Workday / ATS shell with footer chrome but no real role content
  if (
    /powered by\s*workday/i.test(t) &&
    /privacy policy/i.test(t) &&
    !/\b(responsibilit|qualification|requirement|what you.?ll|about the role|minimum qualifications|preferred qualifications|basic qualifications|internship)\b/i.test(
      t
    )
  ) {
    return true;
  }

  // Career-site index / search-results pages scraped instead of a single JD
  if (
    /\b(?:current openings?|jobs search results|back to jobs search)\b/i.test(t) &&
    /\b\d{2,}\s+jobs?\b/i.test(t)
  ) {
    return true;
  }
  if (
    /\bjobs search results\b/i.test(t) &&
    !/\b(responsibilit|qualification|requirement|minimum qualifications|job description summary)\b/i.test(
      t
    )
  ) {
    return true;
  }

  const hasJdStructure =
    /\b(responsibilit|qualification|requirement|what you.?ll|about the role|job description|minimum qualifications|preferred qualifications|basic qualifications|you will|we.?re looking for|job description summary)\b/i.test(
      t
    );
  const techHits = (
    t.match(
      /\b(python|java(?:script)?|typescript|react|node|c\+\+|sql|aws|docker|kubernetes|linux|api|backend|frontend|software|intern|engineer|full[- ]?stack)\b/gi
    ) || []
  ).length;
  if (!hasJdStructure && techHits < 3) return true;

  // Legacy GitHub-list placeholders we used to invent
  if (/from curated GitHub list/i.test(t)) return true;
  const lastLine = raw.split('\n').pop()?.trim() || '';
  if (/^Apply:\s*https?:\/\//i.test(lastLine) && t.length < 400) return true;

  return false;
}

/** @deprecated use isInvalidOrMissingJd */
export function isPlaceholderGithubJd(text: string): boolean {
  return isInvalidOrMissingJd(text);
}
