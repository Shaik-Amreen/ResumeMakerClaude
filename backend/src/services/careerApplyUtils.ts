/**
 * Pure helpers for advanced career-page apply behavior.
 */

export const GREENHOUSE_IFRAME_SELECTORS = [
  '#grnhse_iframe',
  'iframe[src*="greenhouse"]',
  'iframe[src*="grnh"]',
  'iframe[title*="Greenhouse"]',
  'iframe[id*="grnh"]',
] as const;

/** CSS selectors for modern Greenhouse job-boards (in-page form). */
export const GREENHOUSE_FIELD_SELECTORS = {
  firstName: ['#first_name', 'input[aria-label="First Name"]', 'input[name="first_name"]'],
  lastName: ['#last_name', 'input[aria-label="Last Name"]', 'input[name="last_name"]'],
  email: ['#email', 'input[aria-label="Email"]', 'input[name="email"]', 'input[type="email"]'],
  phone: ['#phone', 'input[aria-label="Phone"]', 'input[name="phone"]', 'input[type="tel"]'],
  linkedin: [
    'input[aria-label*="LinkedIn"]',
    'input[aria-label*="Linkedin"]',
    'input[name*="linkedin"]',
    'input[id*="linkedin"]',
  ],
  website: [
    'input[aria-label*="Website"]',
    'input[aria-label*="Portfolio"]',
    'input[name*="website"]',
  ],
  resume: ['#resume', 'input[type="file"][id="resume"]', 'input[type="file"][name*="resume"]'],
  coverLetterFile: ['#cover_letter', 'input[type="file"][id="cover_letter"]'],
  coverLetterText: [
    'textarea#cover_letter_text',
    'textarea[name*="cover"]',
    'textarea[aria-label*="Cover"]',
  ],
} as const;

export const LEVER_FIELD_SELECTORS = {
  name: ['input[name="name"]', '#name'],
  email: ['input[name="email"]', '#email'],
  phone: ['input[name="phone"]', '#phone'],
  org: ['input[name="org"]', '#org'],
  linkedin: ['input[name="urls[LinkedIn]"]', 'input[name="urls[Linkedin]"]'],
  github: ['input[name="urls[Github]"]', 'input[name="urls[GitHub]"]'],
  portfolio: ['input[name="urls[Portfolio]"]', 'input[name="urls[Other]"]'],
  resume: ['input[name="resume"]', 'input[type="file"][name="resume"]'],
  coverLetter: ['textarea[name="comments"]', 'textarea[name="additionalInformation"]'],
} as const;

/** Workday data-automation-id values commonly used on career apply flows. */
export const WORKDAY_AUTOMATION_IDS = {
  email: ['email', 'emailAddress'],
  password: ['password', 'createPassword', 'newPasswordInput'],
  verifyPassword: ['verifyPassword', 'confirmPassword'],
  firstName: ['legalNameSection_firstName', 'firstName', 'name--legalName--firstName'],
  lastName: ['legalNameSection_lastName', 'lastName', 'name--legalName--lastName'],
  phone: ['phone-number', 'phone', 'phoneNumber'],
  apply: ['adventureButton', 'applyButton', 'apply'],
  next: ['bottom-navigation-next-button', 'pageFooterNextButton'],
  createAccountSubmit: ['createAccountSubmitButton'],
  createAccountCheckbox: ['createAccountCheckbox', 'agreementCheckbox'],
  createAccountLink: ['createAccountLink', 'createAccountButton'],
  beecatcher: ['beecatcher'],
} as const;

/** Hidden anti-bot fields that must never be filled. */
export const HONEYPOT_FIELD_PATTERN =
  /beecatcher|honey.?pot|website_url|fax_number|leave.?blank|do.?not.?fill/i;

export function isHoneypotField(labelOrName: string): boolean {
  return HONEYPOT_FIELD_PATTERN.test(labelOrName || '');
}

/** File inputs that are cover letters — do not attach the resume PDF here. */
export function isCoverLetterFileField(labelOrNameOrId: string): boolean {
  return /cover[_\s-]?letter|covering[_\s-]?letter/i.test(labelOrNameOrId || '');
}

/**
 * Lever posting → apply URL.
 * https://jobs.lever.co/acme/uuid → …/uuid/apply
 */
export function resolveLeverApplyUrl(url: string): string {
  const raw = (url || '').trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (!/jobs\.lever\.co$/i.test(u.hostname) && !/\.lever\.co$/i.test(u.hostname)) {
      return raw;
    }
    const path = u.pathname.replace(/\/+$/, '');
    if (/\/(apply|thanks)$/i.test(path)) return raw.split('#')[0];
    if (/^\/[^/]+\/[^/]+$/i.test(path)) {
      u.pathname = `${path}/apply`;
      u.hash = '';
      return u.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

export function looksLikeSuccessPage(url: string, bodyText: string): boolean {
  const t = `${url} ${bodyText}`.toLowerCase();
  return (
    /thank\s*you/.test(t) ||
    /application\s+(has\s+been\s+)?submitted/.test(t) ||
    /successfully\s+submitted/.test(t) ||
    /we\s+received\s+your\s+application/.test(t) ||
    /\/thanks(\/|$|\?)/i.test(url) ||
    /leverappid=/i.test(url) ||
    /confirmation/i.test(t)
  );
}

export function isGreenhouseEmbedUrl(url: string): boolean {
  return /greenhouse\.io\/(?:embed\/)?job_app/i.test(url || '');
}

/**
 * Workday / portal account walls — automation should soft-hold for the user.
 */
export function detectAccountWall(url: string, bodyText: string): string | null {
  const u = (url || '').toLowerCase();
  const t = `${u}\n${bodyText}`.toLowerCase();

  // Paychex AppOne / applicant portals often land on ApplicantLogin.asp after Apply Now.
  if (
    /applicantlogin\.asp/i.test(u) ||
    /userregistration\.aspx/i.test(u) ||
    (/appone\.com/i.test(u) && /login|signin|sign-in|applicant|registration/i.test(u))
  ) {
    return 'AppOne / applicant login required — sign in or create an account in Chrome, then continue the form.';
  }

  if (
    /create\s+account/.test(t) ||
    /sign\s*in\s+to\s+apply/.test(t) ||
    /sign\s*in\s+to\s+continue/.test(t) ||
    /already\s+have\s+an\s+account/.test(t) ||
    /verify\s+(your\s+)?email/.test(t) ||
    /check\s+your\s+email/.test(t) ||
    (/\/login|\/signin|\/sign-in|applicant.?login/i.test(u) && /password/.test(t))
  ) {
    if (
      /password/.test(t) ||
      /create\s+account/.test(t) ||
      /sign\s*in/.test(t) ||
      /verify/.test(t) ||
      /login/.test(t)
    ) {
      return 'Account / sign-in wall detected — complete login or email verification in Chrome.';
    }
  }
  return null;
}

export function detectCaptchaWall(bodyText: string): string | null {
  const t = (bodyText || '').toLowerCase();
  if (
    /\bhcaptcha\b/.test(t) ||
    /\brecaptcha\b/.test(t) ||
    /cf-turnstile/.test(t) ||
    /i'?m\s+not\s+a\s+robot/.test(t) ||
    /verify\s+you\s+are\s+human/.test(t)
  ) {
    return 'CAPTCHA / bot check detected — solve it in Chrome, then retry or finish manually.';
  }
  return null;
}

/** Post-submit validation banners — do not treat as applied. */
export function detectValidationErrors(bodyText: string): string | null {
  const t = (bodyText || '').toLowerCase();
  if (
    /please\s+fix/.test(t) ||
    /required\s+field/.test(t) ||
    /this\s+field\s+is\s+required/.test(t) ||
    /there\s+(was|were)\s+\d+\s+error/.test(t) ||
    /complete\s+all\s+required/.test(t) ||
    /missing\s+required/.test(t)
  ) {
    return 'Form validation errors still visible after submit — fix in Chrome.';
  }
  return null;
}

export type PageBlockerKind = 'account' | 'captcha' | 'validation' | null;

export function classifyPageBlocker(
  url: string,
  bodyText: string
): { kind: PageBlockerKind; reason: string } | null {
  const captcha = detectCaptchaWall(bodyText);
  if (captcha) return { kind: 'captcha', reason: captcha };
  const account = detectAccountWall(url, bodyText);
  if (account) return { kind: 'account', reason: account };
  const validation = detectValidationErrors(bodyText);
  if (validation) return { kind: 'validation', reason: validation };
  return null;
}
