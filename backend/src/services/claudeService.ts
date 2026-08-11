import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { By, Key, until, WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import { releaseDriver } from './chromeProfile';
import { syncGreenSession } from './cookieSync';

const LONG_PASTE_CHARS = 2500;

function copyToClipboard(text: string) {
  execSync('pbcopy', { input: text });
}

function buildMessage(jobDescription: string, latexResume: string): string {
  const jd = jobDescription.trim();
  const latex = latexResume.trim();
  if (!jd) throw new Error('Job description is empty.');
  if (!latex) throw new Error('LaTeX from ChatGPT is empty.');
  return `Tailor this resume to 100% match to JD:\n\n${jd}\n\n${latex}`;
}

async function findClaudeInput(driver: WebDriver) {
  const selectors = [
    'div[contenteditable="true"][data-testid="chat-input"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  for (const selector of selectors) {
    try {
      return await driver.wait(until.elementLocated(By.css(selector)), 20000);
    } catch {
      // try next
    }
  }
  throw new Error('Claude input not found.');
}

async function focusClaudeInput(driver: WebDriver, input: unknown) {
  try {
    await driver.executeScript(
      "arguments[0].scrollIntoView({block:'center'}); arguments[0].focus(); arguments[0].click();",
      input
    );
  } catch {
    await (input as { click: () => Promise<void> }).click();
  }
}

async function clearClaudeInput(driver: WebDriver, input: unknown) {
  await focusClaudeInput(driver, input);
  await driver.sleep(200);
  await driver.actions().keyDown(Key.COMMAND).sendKeys('a').keyUp(Key.COMMAND).perform();
  await driver.sleep(100);
  await driver.actions().sendKeys(Key.BACK_SPACE).perform();
  await driver.sleep(200);
}

async function cdpInsertText(driver: WebDriver, text: string) {
  const conn = await driver.createCDPConnection('page');
  await conn.execute('Input.insertText', { text });
}

async function dispatchComposerEnter(driver: WebDriver, input: unknown, metaKey = false) {
  await driver.executeScript(
    `const el = arguments[0];
     const meta = arguments[1];
     el.focus();
     const opts = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, metaKey: meta };
     el.dispatchEvent(new KeyboardEvent('keydown', opts));
     el.dispatchEvent(new KeyboardEvent('keypress', opts));
     el.dispatchEvent(new KeyboardEvent('keyup', opts));`,
    input,
    metaKey
  );
}

async function uploadClaudeAttachment(driver: WebDriver, filePath: string) {
  const fileInput = await driver.wait(
    until.elementLocated(By.css('input[data-testid="file-upload"]')),
    10000
  );
  await fileInput.sendKeys(filePath);
  await driver.sleep(2000);
}

async function insertClaudeText(driver: WebDriver, input: unknown, text: string) {
  await clearClaudeInput(driver, input);
  await focusClaudeInput(driver, input);
  await driver.sleep(250);

  try {
    await cdpInsertText(driver, text);
    await driver.sleep(600);
    const len = await inputTextLength(driver, input);
    if (len >= Math.min(40, text.length)) {
      console.log(`Claude message inserted via CDP (${text.length} chars)`);
      return;
    }
  } catch (err) {
    console.warn('Claude CDP insert failed, trying clipboard:', (err as Error).message);
  }

  try {
    copyToClipboard(text);
    await focusClaudeInput(driver, input);
    await driver.sleep(300);
    await driver.actions().keyDown(Key.COMMAND).sendKeys('v').keyUp(Key.COMMAND).perform();
    await driver.sleep(1500);
    const len = await inputTextLength(driver, input);
    if (len >= Math.min(80, Math.max(20, Math.floor(text.length / 5)))) {
      console.log(`Claude message pasted (${text.length} chars)`);
      return;
    }
  } catch {
    // fall through
  }

  const b64 = Buffer.from(text, 'utf8').toString('base64');
  await driver.executeScript(
    `const raw = atob(arguments[0]);
     const el = arguments[1];
     el.focus();
     document.execCommand('selectAll', false, null);
     document.execCommand('insertText', false, raw);
     el.dispatchEvent(new InputEvent('input', {
       bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: raw
     }));`,
    b64,
    input
  );
  await driver.sleep(800);
  console.log(`Claude message inserted via execCommand (${text.length} chars)`);
}

async function fillClaudeComposer(driver: WebDriver, input: unknown, text: string) {
  if (text.length <= LONG_PASTE_CHARS) {
    await insertClaudeText(driver, input, text);
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `claude-jd-latex-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, text, 'utf8');
  try {
    const prompt =
      'Tailor this resume to 100% match to JD. The full job description and LaTeX resume are in the attached file.';
    await insertClaudeText(driver, input, prompt);
    await uploadClaudeAttachment(driver, tmpFile);
    console.log(`Claude long message uploaded as file (${text.length} chars)`);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function ensureClaudeChatReady(driver: WebDriver) {
  const url = await driver.getCurrentUrl();
  if (url.includes('/new') || /\/chats\/[a-f0-9-]+/i.test(url)) return;

  await driver.get('https://claude.ai/new');
  await driver.sleep(2500);
}

async function inputTextLength(driver: WebDriver, input: unknown): Promise<number> {
  const len = await driver.executeScript(
    `const el = arguments[0];
     if (!el) return 0;
     if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return (el.value || '').length;
     return (el.innerText || el.textContent || '').length;`,
    input
  );
  return typeof len === 'number' ? len : 0;
}

async function userMessageCount(driver: WebDriver): Promise<number> {
  const count = await driver.executeScript(`
    return document.querySelectorAll(
      '[data-testid="user-message"], [data-message-author-role="user"]'
    ).length;
  `);
  return typeof count === 'number' ? count : 0;
}

async function hasComposerContent(driver: WebDriver): Promise<boolean> {
  return Boolean(
    await driver.executeScript(`
      const input = document.querySelector('[data-testid="chat-input"]');
      const text = (input?.innerText || input?.textContent || '').trim();
      if (text.length > 1) return true;
      const body = document.body.innerText || '';
      return body.includes('Pasted Text') || body.includes('Pasted content');
    `)
  );
}

async function waitForClaudeSendEnabled(driver: WebDriver, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const enabled = await driver.executeScript(`
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      };
      const skip = new Set([
        'add files, connectors, and more',
        'press and hold to record',
        'use voice mode',
        'settings',
      ]);
      const fieldset = document.querySelector('fieldset');
      if (fieldset) {
        for (const btn of fieldset.querySelectorAll('button')) {
          if (!visible(btn)) continue;
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (skip.has(label) || label.startsWith('model:')) continue;
          if (label.includes('send') && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            return true;
          }
          const svg = btn.querySelector('svg');
          if (svg && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            const paths = [...svg.querySelectorAll('path')].map(p => p.getAttribute('d') || '').join(' ');
            if (paths.includes('M10 3') || paths.includes('M12 19')) return true;
          }
        }
      }
      const selectors = [
        'button[aria-label="Send message"]',
        'button[aria-label="Send Message"]',
        'button[aria-label*="Send" i]',
        'button[data-testid="send-button"]',
        'fieldset button[type="submit"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (!btn || !visible(btn)) continue;
        if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return true;
      }
      return false;
    `);
    if (enabled) return true;
    await driver.sleep(400);
  }
  return false;
}

async function clickClaudeSend(driver: WebDriver): Promise<boolean> {
  return Boolean(
    await driver.executeScript(`
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      };
      const skip = new Set([
        'add files, connectors, and more',
        'press and hold to record',
        'use voice mode',
        'settings',
      ]);
      const tryClick = (btn) => {
        if (!btn || !visible(btn)) return false;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
        btn.click();
        return true;
      };
      const fieldset = document.querySelector('fieldset');
      if (fieldset) {
        for (const btn of fieldset.querySelectorAll('button')) {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (skip.has(label) || label.startsWith('model:')) continue;
          if (label.includes('send') && tryClick(btn)) return true;
          const svg = btn.querySelector('svg');
          if (svg) {
            const paths = [...svg.querySelectorAll('path')].map(p => p.getAttribute('d') || '').join(' ');
            if ((paths.includes('M10 3') || paths.includes('M12 19')) && tryClick(btn)) return true;
          }
        }
      }
      const candidates = [
        ...document.querySelectorAll(
          'button[aria-label="Send message"], button[aria-label="Send Message"], button[aria-label*="Send" i], button[data-testid="send-button"], fieldset button[type="submit"]'
        ),
      ];
      for (const btn of candidates) {
        if (tryClick(btn)) return true;
      }
      return false;
    `)
  );
}

async function submitClaudeMessage(driver: WebDriver, input: unknown, usersBefore: number) {
  await focusClaudeInput(driver, input);
  await driver.sleep(300);
  await driver.actions().sendKeys(' ').sendKeys(Key.BACK_SPACE).perform();
  await driver.sleep(500);

  const hasContent = await hasComposerContent(driver);
  if (!hasContent) {
    throw new Error('Claude composer is empty after paste — retry or paste manually.');
  }

  await waitForClaudeSendEnabled(driver, 8000);

  for (let attempt = 1; attempt <= 5; attempt++) {
    await focusClaudeInput(driver, input);
    await dispatchComposerEnter(driver, input, false);
    await driver.sleep(1200);
    if ((await userMessageCount(driver)) > usersBefore) {
      console.log('Claude message sent via Enter (KeyboardEvent)');
      return;
    }

    await focusClaudeInput(driver, input);
    await dispatchComposerEnter(driver, input, true);
    await driver.sleep(1200);
    if ((await userMessageCount(driver)) > usersBefore) {
      console.log('Claude message sent via Cmd+Enter (KeyboardEvent)');
      return;
    }

    const clicked = await clickClaudeSend(driver);
    if (clicked) {
      await driver.sleep(1200);
      if ((await userMessageCount(driver)) > usersBefore) {
        console.log('Claude message sent via send button');
        return;
      }
    }

    await focusClaudeInput(driver, input);
    await driver.actions().sendKeys(Key.RETURN).perform();
    await driver.sleep(1200);
    if ((await userMessageCount(driver)) > usersBefore) {
      console.log('Claude message sent via Enter (actions)');
      return;
    }
  }

  throw new Error('Claude message pasted but not sent — click Send manually or retry.');
}

const ASSISTANT_SELECTORS =
  '.font-claude-response, .font-claude-message, [data-testid="assistant-message"], [data-message-author-role="assistant"]';

async function assistantCount(driver: WebDriver): Promise<number> {
  const count = await driver.executeScript(`
    const nodes = document.querySelectorAll(arguments[0]);
    if (nodes.length) return nodes.length;
    return document.querySelectorAll('div.group.relative .font-claude-response').length;
  `, ASSISTANT_SELECTORS);
  return typeof count === 'number' ? count : 0;
}

async function claudeStillGenerating(driver: WebDriver): Promise<boolean> {
  return Boolean(
    await driver.executeScript(`
      const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const stop = document.querySelector('button[aria-label*="Stop" i], button[data-testid="stop-button"]');
      return visible(stop);
    `)
  );
}

async function latestClaudeText(driver: WebDriver): Promise<string> {
  const text = await driver.executeScript(`
    const sel = arguments[0];
    let nodes = document.querySelectorAll(sel);
    if (!nodes.length) {
      nodes = document.querySelectorAll('div.group.relative .font-claude-response');
    }
    if (!nodes.length) return '';
    const latest = nodes[nodes.length - 1];
    return (latest.innerText || latest.textContent || '').trim();
  `, ASSISTANT_SELECTORS);
  return typeof text === 'string' ? text : '';
}

async function waitForClaudeReply(driver: WebDriver, waitMs: number, turnsBefore: number) {
  console.log(`Waiting for Claude to finish (up to ${Math.round(waitMs / 1000)}s)...`);
  await driver.sleep(3000);
  const deadline = Date.now() + waitMs;
  let lastText = '';
  let stable = 0;

  while (Date.now() < deadline) {
    if (await claudeStillGenerating(driver)) {
      stable = 0;
      await driver.sleep(2000);
      continue;
    }

    const turns = await assistantCount(driver);
    if (turns <= turnsBefore) {
      await driver.sleep(2000);
      continue;
    }

    const text = await latestClaudeText(driver);
    if (text.length > 40 && text === lastText) {
      stable += 1;
      if (stable >= 3) {
        console.log(`Claude response complete (${text.length} chars)`);
        return text;
      }
    } else {
      stable = 0;
      lastText = text;
    }
    await driver.sleep(2000);
  }

  const partial = await latestClaudeText(driver);
  if (partial) return partial;
  throw new Error('Timed out waiting for Claude response.');
}

function isYesMatch(text: string): boolean {
  const firstLine = (text.split('\n')[0] || '').trim().toUpperCase();
  if (firstLine === 'YES' || firstLine.startsWith('YES ')) return true;
  return /\b100\s*%\s*match\b/i.test(text) && !/\bnot\b/i.test(text.split('\n')[0] || '');
}

async function extractRevisedLatex(driver: WebDriver, fallback: string): Promise<string> {
  const latex = await driver.executeScript(`
    const sel = arguments[0];
    let nodes = document.querySelectorAll(sel);
    if (!nodes.length) {
      nodes = document.querySelectorAll('div.group.relative .font-claude-response');
    }
    if (!nodes.length) return '';
    const latest = nodes[nodes.length - 1];
    const codes = latest.querySelectorAll('pre code');
    if (codes.length) return (codes[codes.length - 1].textContent || '').trim();
    return '';
  `, ASSISTANT_SELECTORS);
  if (typeof latex === 'string' && latex.trim()) return latex.trim();
  return fallback;
}

export async function evaluateWithClaude(
  driver: WebDriver,
  latexResume: string,
  jobDescription: string
): Promise<{ isMatch: boolean; latex?: string }> {
  const chatGptHandle = await driver.getWindowHandle();
  console.log('Step 2/2: Claude — opening new tab...');

  await driver.switchTo().newWindow('tab');
  await driver.get(config.claude.url);
  await syncGreenSession(driver, config.claude.url);
  await driver.sleep(2500);
  await ensureClaudeChatReady(driver);

  const message = buildMessage(jobDescription, latexResume);
  const turnsBefore = await assistantCount(driver);
  const usersBefore = await userMessageCount(driver);
  const input = await findClaudeInput(driver);
  await fillClaudeComposer(driver, input, message);
  await submitClaudeMessage(driver, input, usersBefore);

  const text = await waitForClaudeReply(driver, config.claude.responseWaitMs, turnsBefore);
  const revised = isYesMatch(text) ? latexResume : await extractRevisedLatex(driver, latexResume);

  try {
    await driver.close();
    await driver.switchTo().window(chatGptHandle);
  } catch {
    // tab may already be closed
  }

  if (isYesMatch(text)) {
    return { isMatch: true, latex: latexResume };
  }

  return { isMatch: false, latex: revised };
}

export async function runClaudeStepOnly(
  latexResume: string,
  jobDescription: string
): Promise<{ isMatch: boolean; latex?: string }> {
  const { attachDriver } = await import('./chromeProfile');
  const driver = await attachDriver({
    kind: 'green',
    userDataDir: config.claude.userDataDir,
    profileDirectory: config.claude.profileDirectory,
    debugPort: config.claude.debugPort,
    headless: config.claude.headless,
    startUrl: config.claude.url,
  });

  try {
    await syncGreenSession(driver, config.claude.url);
    await driver.get(config.claude.url);
    await driver.sleep(2500);
    await ensureClaudeChatReady(driver);

    console.log('Claude — pasting JD + LaTeX (Claude-only step)...');
    const message = buildMessage(jobDescription, latexResume);
    const turnsBefore = await assistantCount(driver);
    const usersBefore = await userMessageCount(driver);
    const input = await findClaudeInput(driver);
    await fillClaudeComposer(driver, input, message);
    await submitClaudeMessage(driver, input, usersBefore);

    const text = await waitForClaudeReply(driver, config.claude.responseWaitMs, turnsBefore);
    const revised = isYesMatch(text) ? latexResume : await extractRevisedLatex(driver, latexResume);

    if (isYesMatch(text)) {
      return { isMatch: true, latex: latexResume };
    }
    return { isMatch: false, latex: revised };
  } finally {
    await releaseDriver(driver);
  }
}

function buildApplicationQuestionPrompt(
  questionLabel: string,
  questionType: 'text' | 'textarea',
  jobDescription: string,
  userInfo: string
): string {
  return `You are filling out a LinkedIn job application form. Answer concisely like a human.

Rules:
1. For years/duration/numeric questions, return ONLY a number (e.g. "2", "5").
2. For Yes/No questions, return ONLY "Yes" or "No".
3. For short answers, one sentence max.
4. For longer answers (textarea), keep under 350 characters.
5. Do NOT repeat the question. Return ONLY the answer text.

User information:
${userInfo}

Job description (context):
${jobDescription.slice(0, 4000)}

Question type: ${questionType}
Question: ${questionLabel}`;
}

let applicationAiDriver: WebDriver | null = null;

/** Reuse green Chrome for multiple Easy Apply AI answers in one apply session. */
export async function createApplicationAiAnswerer(userInfo: string) {
  const { attachDriver } = await import('./chromeProfile');

  async function ensureDriver(): Promise<WebDriver> {
    if (applicationAiDriver) return applicationAiDriver;
    applicationAiDriver = await attachDriver({
      kind: 'green',
      userDataDir: config.claude.userDataDir,
      profileDirectory: config.claude.profileDirectory,
      debugPort: config.claude.debugPort,
      headless: config.claude.headless,
      startUrl: config.claude.url,
    });
    await syncGreenSession(applicationAiDriver, config.claude.url);
    await applicationAiDriver.get('https://claude.ai/new');
    await applicationAiDriver.sleep(2500);
    return applicationAiDriver;
  }

  return async (
    questionLabel: string,
    questionType: 'text' | 'textarea',
    jobDescription: string
  ): Promise<string | null> => {
    try {
      const driver = await ensureDriver();
      await ensureClaudeChatReady(driver);

      const message = buildApplicationQuestionPrompt(
        questionLabel,
        questionType,
        jobDescription,
        userInfo
      );
      const turnsBefore = await assistantCount(driver);
      const usersBefore = await userMessageCount(driver);
      const input = await findClaudeInput(driver);
      await fillClaudeComposer(driver, input, message);
      await submitClaudeMessage(driver, input, usersBefore);

      const text = await waitForClaudeReply(driver, Math.min(config.claude.responseWaitMs, 90000), turnsBefore);
      const answer = text.split('\n').map((l) => l.trim()).filter(Boolean)[0] || text.trim();
      return answer.slice(0, 350) || null;
    } catch (err) {
      console.warn('Claude application Q&A failed:', (err as Error).message);
      return null;
    }
  };
}

export async function closeApplicationAiSession() {
  if (applicationAiDriver) {
    await releaseDriver(applicationAiDriver);
    applicationAiDriver = null;
  }
}
