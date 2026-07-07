import { execSync } from 'child_process';
import { By, Key, until, WebDriver } from 'selenium-webdriver';
import { config } from '../config';
import { attachDriver, releaseDriver } from './chromeProfile';
import { syncGreenSession } from './cookieSync';

function greenProfile(startUrl: string) {
  const { chatgpt } = config;
  return {
    kind: 'green' as const,
    userDataDir: chatgpt.userDataDir,
    profileDirectory: chatgpt.profileDirectory,
    debugPort: chatgpt.debugPort,
    headless: chatgpt.headless,
    startUrl,
  };
}

function chatgptUrlWithModel(url: string, model: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('model', model);
  return parsed.toString();
}

function jobDescriptionOnly(jobDescription: string): string {
  const jd = jobDescription.trim();
  if (!jd) throw new Error('Job description is empty — cannot generate resume.');
  return jd;
}

function copyToClipboard(text: string) {
  execSync('pbcopy', { input: text });
}

async function composerTextLength(driver: WebDriver, element: unknown): Promise<number> {
  const len = await driver.executeScript(
    `const el = arguments[0];
     if (!el) return 0;
     if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return (el.value || '').length;
     return (el.innerText || el.textContent || '').length;`,
    element
  );
  return typeof len === 'number' ? len : 0;
}

async function findComposer(driver: WebDriver) {
  const selectors = [
    '#prompt-textarea',
    'div#prompt-textarea[contenteditable="true"]',
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
  throw new Error('ChatGPT input not found.');
}

async function pastePrompt(driver: WebDriver, composer: unknown, prompt: string) {
  const minLen = Math.min(80, Math.max(20, Math.floor(prompt.length / 5)));

  const focus = async () => {
    try {
      await driver.executeScript(
        "arguments[0].scrollIntoView({block:'center'}); arguments[0].focus();",
        composer
      );
    } catch {
      await (composer as { click: () => Promise<void> }).click();
    }
  };

  try {
    copyToClipboard(prompt);
    await focus();
    await driver.sleep(350);
    await driver.actions().keyDown(Key.COMMAND).sendKeys('a').keyUp(Key.COMMAND).perform();
    await driver.sleep(150);
    await driver.actions().keyDown(Key.COMMAND).sendKeys('v').keyUp(Key.COMMAND).perform();
    await driver.sleep(1200);
    if ((await composerTextLength(driver, composer)) >= minLen) {
      console.log(`ChatGPT prompt pasted (${prompt.length} chars)`);
      return;
    }
  } catch {
    // fall through
  }

  const b64 = Buffer.from(prompt, 'utf8').toString('base64');
  await driver.executeScript(
    `const text = atob(arguments[0]);
     const el = arguments[1];
     el.focus();
     if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
       el.value = text;
     } else {
       el.innerHTML = '';
       const p = document.createElement('p');
       p.textContent = text;
       el.appendChild(p);
     }
     el.dispatchEvent(new InputEvent('input', {
       bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: text
     }));`,
    b64,
    composer
  );
  await driver.sleep(1000);

  const got = await composerTextLength(driver, composer);
  if (got < minLen) {
    throw new Error(`ChatGPT prompt incomplete (${got}/${prompt.length} chars pasted).`);
  }
  console.log(`ChatGPT prompt inserted via JS (${prompt.length} chars)`);
}

type ModelState = 'instant' | 'pro' | 'thinking' | 'unknown';

async function readModelState(driver: WebDriver): Promise<ModelState> {
  const state = await driver.executeScript(`
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const labels = [];

    const push = (text) => {
      const t = norm(text);
      if (t) labels.push(t);
    };

    const selectorBtn = document.querySelector(
      '[data-testid="model-switcher-dropdown-button"], [data-testid="composer-action-model-selector"]'
    );
    if (selectorBtn) {
      const inner = selectorBtn.querySelector(
        '[data-testid="selected-model"], [data-testid="model-switcher-selected-model"]'
      );
      push(inner?.textContent || selectorBtn.textContent);
    }

    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      const t = norm(btn.textContent);
      if (t === 'pro' || t === 'instant' || t === 'thinking') push(t);
    }

    if (labels.some((l) => l === 'pro' || l.startsWith('pro ') || l.includes('pro thinking'))) return 'pro';
    if (labels.some((l) => l === 'thinking' || l.includes('thinking'))) return 'thinking';
    if (labels.some((l) => l === 'instant' || l.startsWith('instant '))) return 'instant';
    return 'unknown';
  `);
  return (state as ModelState) || 'unknown';
}

async function clickInstantInOpenMenu(driver: WebDriver): Promise<boolean> {
  const xpaths = [
    "//*[@role='menuitemradio'][normalize-space(.)='Instant']",
    "//*[@role='menuitem'][normalize-space(.)='Instant']",
    "//*[@role='option'][normalize-space(.)='Instant']",
    "//*[normalize-space(.)='Instant' and (@role='menuitemradio' or @role='menuitem' or @role='option')]",
  ];
  for (const xpath of xpaths) {
    try {
      const el = await driver.findElement(By.xpath(xpath));
      await el.click();
      return true;
    } catch {
      // try next
    }
  }

  return Boolean(
    await driver.executeScript(`
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const items = [
        ...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], [role="menuitemcheckbox"]'),
      ];
      const instant = items.find((el) => {
        const t = norm(el.textContent);
        return t === 'instant' || t.startsWith('instant ');
      });
      if (!instant) return false;
      instant.click();
      return true;
    `)
  );
}

async function openModelMenu(driver: WebDriver): Promise<void> {
  const xpaths = [
    "//*[@data-testid='composer-action-model-selector']",
    "//*[@data-testid='model-switcher-dropdown-button']",
    "//button[normalize-space(.)='Pro']",
    "//button[normalize-space(.)='Thinking']",
    "//button[normalize-space(.)='Instant']",
    "//button[contains(.,'Pro') and string-length(normalize-space(.)) < 12]",
  ];

  for (const xpath of xpaths) {
    try {
      const el = await driver.findElement(By.xpath(xpath));
      await driver.executeScript(
        "arguments[0].scrollIntoView({block:'center'}); arguments[0].click();",
        el
      );
      await driver.sleep(700);
      return;
    } catch {
      // try next
    }
  }

  const opened = await driver.executeScript(`
    const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      const rect = btn.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      const t = norm(btn.textContent);
      if (t === 'pro' || t === 'thinking' || t === 'instant') {
        btn.click();
        return true;
      }
    }
    return false;
  `);
  if (!opened) throw new Error('ChatGPT model menu button not found.');
  await driver.sleep(700);
}

async function selectInstantModel(driver: WebDriver, pageUrl: string) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let state = await readModelState(driver);
    if (state === 'instant') {
      console.log('ChatGPT model: Instant');
      return;
    }

    console.log(`ChatGPT on ${state} — switching to Instant (attempt ${attempt}/4)...`);

    if (attempt === 2) {
      await driver.get(chatgptUrlWithModel(pageUrl, config.chatgpt.model));
      await driver.sleep(2500);
      state = await readModelState(driver);
      if (state === 'instant') {
        console.log('ChatGPT model: Instant (via URL reload)');
        return;
      }
    }

    try {
      await openModelMenu(driver);
      const clicked = await clickInstantInOpenMenu(driver);
      await driver.sleep(800);
      if (!clicked) {
        await driver.actions().sendKeys(Key.ESCAPE).perform();
        continue;
      }
    } catch (err) {
      console.warn('Model menu switch failed:', err instanceof Error ? err.message : err);
    }

    state = await readModelState(driver);
    if (state === 'instant') {
      console.log('ChatGPT model: Instant');
      return;
    }

    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await driver.sleep(500);
  }

  const finalState = await readModelState(driver);
  if (finalState === 'pro' || finalState === 'thinking') {
    console.warn(
      `ChatGPT still on ${finalState} in pinned chat — continuing (switch to Instant in UI if you want faster runs).`
    );
    return;
  }
  console.warn(`ChatGPT model state unclear (${finalState}) — continuing.`);
}

async function submitPrompt(driver: WebDriver) {
  const sendSelectors = [
    '[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label*="Send" i]',
  ];
  for (const selector of sendSelectors) {
    try {
      const btn = await driver.findElement(By.css(selector));
      const disabled = await btn.getAttribute('aria-disabled');
      if (disabled !== 'true') {
        await btn.click();
        return;
      }
    } catch {
      // try next
    }
  }
  await driver.actions().sendKeys(Key.RETURN).perform();
}

async function assistantTurnCount(driver: WebDriver): Promise<number> {
  const count = await driver.executeScript(
    `return document.querySelectorAll('[data-message-author-role="assistant"]').length;`
  );
  return typeof count === 'number' ? count : 0;
}

async function responseStillGenerating(driver: WebDriver): Promise<boolean> {
  return Boolean(
    await driver.executeScript(`
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const stop = document.querySelector(
        'button[aria-label="Stop generating"], button[data-testid="stop-button"], button[aria-label*="Stop" i]'
      );
      if (visible(stop)) return true;
      const loading = document.querySelector('[data-testid="composer-loading"]');
      if (visible(loading)) return true;
      const streaming = document.querySelector('[data-testid="stop-streaming-button"]');
      return visible(streaming);
    `)
  );
}

async function latestAssistantText(driver: WebDriver): Promise<string> {
  const text = await driver.executeScript(`
    const pick = (root) => (root.innerText || root.textContent || '').trim();
    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"]',
    ];
    let nodes = [];
    for (const sel of selectors) {
      nodes = Array.from(document.querySelectorAll(sel));
      if (nodes.length) break;
    }
    if (!nodes.length) return '';
    return pick(nodes[nodes.length - 1]);
  `);
  return typeof text === 'string' ? text : '';
}

async function waitForAssistantReply(
  driver: WebDriver,
  waitMs: number,
  turnsBefore: number
) {
  console.log(`Waiting for ChatGPT to finish (up to ${Math.round(waitMs / 1000)}s)...`);
  await driver.sleep(3000);
  const deadline = Date.now() + waitMs;
  let lastText = '';
  let stable = 0;

  while (Date.now() < deadline) {
    if (await responseStillGenerating(driver)) {
      stable = 0;
      await driver.sleep(2000);
      continue;
    }

    const turns = await assistantTurnCount(driver);
    if (turns <= turnsBefore) {
      await driver.sleep(2000);
      continue;
    }

    const text = await latestAssistantText(driver);
    if (text.length > 40 && text === lastText) {
      stable += 1;
      if (stable >= 3) {
        console.log(`ChatGPT response complete (${text.length} chars)`);
        return;
      }
    } else {
      stable = 0;
      lastText = text;
    }
    await driver.sleep(2000);
  }

  throw new Error('Timed out waiting for ChatGPT response to finish.');
}

async function extractLatex(driver: WebDriver): Promise<string> {
  const latex = await driver.executeScript(`
    const turns = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (!turns.length) return '';
    const latest = turns[turns.length - 1];
    const codes = latest.querySelectorAll('pre code');
    if (codes.length) return (codes[codes.length - 1].textContent || '').trim();
    return (latest.innerText || latest.textContent || '').trim();
  `);
  if (typeof latex !== 'string' || !latex.trim()) {
    throw new Error('No LaTeX code block in latest ChatGPT response.');
  }
  return latex.trim();
}

export async function readLatexFromOpenChatGPT(): Promise<string | null> {
  const baseUrl = config.chatgpt.url;
  const url = chatgptUrlWithModel(baseUrl, config.chatgpt.model);
  const driver = await attachDriver(greenProfile(url));
  try {
    await driver.get(url);
    await driver.sleep(2500);
    try {
      const latex = await extractLatex(driver);
      console.log(`Read LaTeX from open ChatGPT tab (${latex.length} chars)`);
      return latex;
    } catch {
      const text = await latestAssistantText(driver);
      if (text.length > 100) {
        console.log(`Read ChatGPT response as text (${text.length} chars)`);
        return text;
      }
      return null;
    }
  } catch (err) {
    console.warn('Could not read from ChatGPT tab:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await releaseDriver(driver);
  }
}

export async function generateResumeWithChatGPT(
  jobDescription: string
): Promise<{ latex: string; driver: WebDriver }> {
  const baseUrl = config.chatgpt.url;
  const url = chatgptUrlWithModel(baseUrl, config.chatgpt.model);
  const driver = await attachDriver(greenProfile(url));
  await syncGreenSession(driver, url);
  await driver.sleep(2000);
  await selectInstantModel(driver, baseUrl);

  const message = jobDescriptionOnly(jobDescription);
  console.log(`Step 1/2: ChatGPT — pasting JD only (${message.length} chars)...`);

  const composer = await findComposer(driver);
  await pastePrompt(driver, composer, message);

  const preSubmit = await readModelState(driver);
  if (preSubmit === 'pro' || preSubmit === 'thinking') {
    console.warn(`ChatGPT on ${preSubmit} — sending JD anyway.`);
  }

  const turnsBefore = await assistantTurnCount(driver);
  await submitPrompt(driver);
  await waitForAssistantReply(driver, config.chatgpt.responseWaitMs, turnsBefore);
  const latex = await extractLatex(driver);
  console.log(`ChatGPT LaTeX ready (${latex.length} chars) — keeping tab open.`);
  return { latex, driver };
}
