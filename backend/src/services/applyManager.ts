/**
 * Apply AI Manager — API brain that directs orange Chrome apply steps.
 * Never opens Claude website / green Chrome. Passwords are never sent to the LLM.
 */
import { WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import type { ApplicationProfile } from '../data/applicationProfile';
import { openRouterChatCompletion } from './resumeAgent/openRouterProvider';
import { logLlmInUse } from './resumeAgent/llmRoute';

export type ApplyManagerActionType =
  | 'click'
  | 'login'
  | 'fill'
  | 'upload_resume'
  | 'next'
  | 'await_submit'
  | 'hold'
  | 'done_check';

export interface ApplyManagerAction {
  type: ApplyManagerActionType;
  /** Human-readable reason for logs / approval notes */
  reason?: string;
  /** For click: visible button/link text */
  text?: string;
  /** For fill: field label match */
  label?: string;
  /** For fill: profile key or short literal (Yes/No) */
  valueKey?: string;
  value?: string;
}

export interface PageControlSnapshot {
  kind: 'input' | 'textarea' | 'select' | 'button' | 'link';
  type?: string;
  label: string;
  name?: string;
  id?: string;
  value?: string;
  options?: string[];
}

export interface ApplyPageSnapshot {
  url: string;
  title: string;
  bodyText: string;
  controls: PageControlSnapshot[];
  hasFileInput: boolean;
  hasPassword: boolean;
  hasApplyCta: boolean;
}

export interface ApplyManagerContext {
  profile: ApplicationProfile;
  hasResume: boolean;
  jobTitle: string;
  company: string;
  lastActions?: string[];
}

const ACTION_TYPES = new Set<string>([
  'click',
  'login',
  'fill',
  'upload_resume',
  'next',
  'await_submit',
  'hold',
  'done_check',
]);

const SYSTEM_PROMPT = `You are the Apply Manager for a job application automation agent.
You see a page snapshot from the employer's career/ATS site in Chrome.
You must return ONE next action as JSON only (no markdown, no code fences).

Rules:
- Prefer completing login/signup walls with action "login" (credentials are handled securely offline — never invent passwords).
- Prefer "click" with exact visible text for Apply Now / Continue / Next when that advances the form.
- Use "fill" for empty required profile fields (firstName, lastName, email, phone, city, state, linkedin, etc.).
- Use "upload_resume" when a resume/CV file input is visible and resume is available.
- Use "next" to go to the next form step when Continue/Next is appropriate.
- Use "await_submit" ONLY when the final Submit Application control is visible and the form looks complete.
- Use "hold" when CAPTCHA, 2FA you cannot solve, or the page is blocked — include reason.
- Use "done_check" if the page already looks like a thank-you / application received page.
- Never ask to open Claude or another AI chat site.
- Never request the user's password in the JSON.

JSON schema:
{"type":"click|login|fill|upload_resume|next|await_submit|hold|done_check","reason":"short","text":"optional click text","label":"optional field label","valueKey":"optional profile key","value":"optional literal"}`;

/** Parse & validate manager JSON (exported for unit tests). */
export function parseApplyManagerAction(raw: string): ApplyManagerAction | null {
  let text = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const type = String(obj.type || '').trim();
    if (!ACTION_TYPES.has(type)) return null;
    return {
      type: type as ApplyManagerActionType,
      reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 240) : undefined,
      text: typeof obj.text === 'string' ? obj.text.slice(0, 120) : undefined,
      label: typeof obj.label === 'string' ? obj.label.slice(0, 120) : undefined,
      valueKey: typeof obj.valueKey === 'string' ? obj.valueKey.slice(0, 80) : undefined,
      value: typeof obj.value === 'string' ? obj.value.slice(0, 200) : undefined,
    };
  } catch {
    return null;
  }
}

export function profileFactsForManager(profile: ApplicationProfile): Record<string, string> {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    city: profile.currentCity,
    state: profile.state,
    zipcode: profile.zipcode,
    country: profile.country,
    linkedin: profile.linkedin,
    website: profile.website,
    recentEmployer: profile.recentEmployer,
    yearsOfExperience: profile.yearsOfExperience,
    legallyAuthorizedToWorkInUS: profile.legallyAuthorizedToWorkInUS,
    nowRequireSponsorship: profile.nowRequireSponsorship,
    futureRequireSponsorship: profile.futureRequireSponsorship,
    requireVisa: profile.requireVisa,
    willingToRelocate: profile.willingToRelocate,
    desiredStartDate: profile.desiredStartDate,
    desiredSalaryRange: `${profile.desiredSalaryMin}-${profile.desiredSalaryMax}`,
  };
}

export async function captureApplyPageSnapshot(
  driver: WebDriver
): Promise<ApplyPageSnapshot> {
  const data = (await driver.executeScript(`
    function cssEsc(id) {
      if (window.CSS && CSS.escape) return CSS.escape(id);
      return String(id).replace(/"/g, '\\"');
    }
    function labelFor(el) {
      const id = el.id;
      if (id) {
        const lab = document.querySelector('label[for="' + cssEsc(id) + '"]');
        if (lab && lab.innerText) return lab.innerText.trim().slice(0, 80);
      }
      return (
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('name') ||
        el.id ||
        (el.innerText || '').trim().slice(0, 60) ||
        el.tagName
      );
    }
    function visible(el) {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && el.offsetParent !== null;
    }
    const controls = [];
    for (const el of document.querySelectorAll('input, textarea, select, button, a[href]')) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden') continue;
      let kind = 'button';
      if (tag === 'input') kind = type === 'submit' || type === 'button' ? 'button' : 'input';
      else if (tag === 'textarea') kind = 'textarea';
      else if (tag === 'select') kind = 'select';
      else if (tag === 'a') kind = 'link';
      const item = {
        kind,
        type: type || undefined,
        label: String(labelFor(el)).slice(0, 80),
        name: el.getAttribute('name') || undefined,
        id: el.id || undefined,
        value: kind === 'input' || kind === 'textarea' ? String(el.value || '').slice(0, 40) : undefined,
      };
      if (tag === 'select') {
        item.options = Array.from(el.options || []).slice(0, 12).map(o => (o.text || '').trim().slice(0, 40));
      }
      controls.push(item);
      if (controls.length >= 40) break;
    }
    const body = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 2500);
    const hasFile = !!document.querySelector('input[type="file"]');
    const hasPassword = !!document.querySelector('input[type="password"]');
    const hasApply = controls.some(c => /apply now|start application|apply for/i.test(c.label || ''));
    return {
      url: location.href,
      title: document.title || '',
      bodyText: body,
      controls,
      hasFileInput: hasFile,
      hasPassword,
      hasApplyCta: hasApply,
    };
  `)) as ApplyPageSnapshot;

  return {
    url: data?.url || '',
    title: data?.title || '',
    bodyText: data?.bodyText || '',
    controls: Array.isArray(data?.controls) ? data.controls : [],
    hasFileInput: !!data?.hasFileInput,
    hasPassword: !!data?.hasPassword,
    hasApplyCta: !!data?.hasApplyCta,
  };
}

function buildUserPrompt(snapshot: ApplyPageSnapshot, ctx: ApplyManagerContext): string {
  const facts = profileFactsForManager(ctx.profile);
  return [
    `JOB: ${ctx.jobTitle} @ ${ctx.company}`,
    `RESUME_AVAILABLE: ${ctx.hasResume ? 'yes' : 'no'}`,
    `PROFILE_FACTS: ${JSON.stringify(facts)}`,
    ctx.lastActions?.length ? `RECENT_ACTIONS: ${ctx.lastActions.slice(-6).join(' | ')}` : '',
    `URL: ${snapshot.url}`,
    `TITLE: ${snapshot.title}`,
    `FLAGS: fileInput=${snapshot.hasFileInput} password=${snapshot.hasPassword} applyCta=${snapshot.hasApplyCta}`,
    `VISIBLE_CONTROLS: ${JSON.stringify(snapshot.controls).slice(0, 6000)}`,
    `PAGE_TEXT: ${snapshot.bodyText.slice(0, 2000)}`,
    'Return ONE JSON action now.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function callOpenRouterManager(userPrompt: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await openRouterChatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: 250,
        temperature: 0.1,
        signal: controller.signal,
        work: 'Apply manager',
      }
    );
  } finally {
    clearTimeout(t);
  }
}

async function callOllamaManager(userPrompt: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    logLlmInUse('Apply manager', `Ollama (${config.ollama.model})`);
    const res = await fetch(`${config.ollama.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        stream: false,
        keep_alive: config.ollama.keepAlive,
        think: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        options: { temperature: 0.1, num_predict: 250 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content || '';
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ask the Apply Manager for the next action.
 * Provider: auto → OpenRouter then Ollama.
 */
export async function askApplyManager(
  snapshot: ApplyPageSnapshot,
  ctx: ApplyManagerContext
): Promise<{ action: ApplyManagerAction | null; provider: string; raw?: string; error?: string }> {
  if (!config.apply.managerEnabled) {
    return { action: null, provider: 'disabled' };
  }

  const userPrompt = buildUserPrompt(snapshot, ctx);
  const timeoutMs = config.apply.managerTimeoutMs;
  const provider = config.apply.managerProvider;
  const order: Array<'openrouter' | 'ollama'> =
    provider === 'ollama'
      ? ['ollama']
      : provider === 'openrouter'
        ? ['openrouter']
        : ['openrouter', 'ollama'];

  let lastError = '';
  for (const p of order) {
    try {
      const raw =
        p === 'openrouter'
          ? await callOpenRouterManager(userPrompt, timeoutMs)
          : await callOllamaManager(userPrompt, timeoutMs);
      const action = parseApplyManagerAction(raw);
      if (action) return { action, provider: p, raw: raw.slice(0, 500) };
      lastError = `${p}: could not parse JSON action`;
    } catch (err) {
      lastError = `${p}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('Apply manager', lastError);
    }
  }

  return { action: null, provider: 'none', error: lastError };
}

/** Heuristic fallback when the API manager is unavailable. */
export function heuristicApplyAction(snapshot: ApplyPageSnapshot): ApplyManagerAction {
  if (/thank you|application (has been )?submitted|application received/i.test(snapshot.bodyText)) {
    return { type: 'done_check', reason: 'Looks like success page' };
  }
  if (snapshot.hasPassword || /applicantlogin|userregistration|sign in|create account/i.test(snapshot.url + snapshot.bodyText)) {
    return { type: 'login', reason: 'Account / login wall detected' };
  }
  if (snapshot.hasApplyCta) {
    return { type: 'click', text: 'Apply Now', reason: 'Apply CTA visible' };
  }
  if (snapshot.hasFileInput) {
    return { type: 'upload_resume', reason: 'File input visible' };
  }
  if (/submit application|send application|complete application/i.test(snapshot.bodyText)) {
    return { type: 'await_submit', reason: 'Submit control likely visible' };
  }
  if (/continue|next/i.test(JSON.stringify(snapshot.controls))) {
    return { type: 'next', reason: 'Continue/Next available' };
  }
  return { type: 'fill', reason: 'Try filling visible profile fields', label: '' };
}
