import { execSync } from 'child_process';
import { By, Key, until, WebDriver, WebElement } from 'selenium-webdriver';
import { config } from '../config';
import { formatResumeProfileForPrompt } from '../data/resumeProfile';
import { attachDriver, releaseDriver } from './chromeProfile';

function greenProfile(startUrl: string) {
  const { ollama } = config;
  return {
    kind: 'green' as const,
    userDataDir: ollama.userDataDir,
    profileDirectory: ollama.profileDirectory,
    debugPort: ollama.debugPort,
    headless: ollama.headless,
    startUrl,
  };
}

export function buildOllamaResumePrompt(jobDescription: string): string {
  const jd = jobDescription.trim();
  if (!jd) throw new Error('Job description is empty.');

  return `You are tailoring a resume for a job application. Use the candidate profile as source of truth — do not invent experience.

Return the FULL tailored resume as LaTeX only, inside a single \`\`\`latex code block. Match the job description as closely as possible. Keep a professional one-page format.

${formatResumeProfileForPrompt()}

JOB DESCRIPTION:
${jd}`;
}

export function extractLatexFromOllamaResponse(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) return fence[1].trim();
  if (/\\documentclass/i.test(trimmed)) return trimmed;
  if (/\\section/i.test(trimmed)) return trimmed;
  throw new Error('No LaTeX code block found in Ollama response.');
}

function copyToClipboard(text: string) {
  execSync('pbcopy', { input: text });
}

function ollamaPageUrl(): string {
  const model = encodeURIComponent(config.ollama.model);
  return `http://127.0.0.1:${config.port}/ollama-resume.html?model=${model}`;
}

async function pastePrompt(driver: WebDriver, textarea: WebElement, prompt: string) {
  await textarea.click();
  await driver.sleep(200);
  await driver.actions().keyDown(Key.COMMAND).sendKeys('a').keyUp(Key.COMMAND).perform();
  await driver.sleep(100);
  await driver.actions().sendKeys(Key.BACK_SPACE).perform();

  try {
    copyToClipboard(prompt);
    await driver.sleep(200);
    await driver.actions().keyDown(Key.COMMAND).sendKeys('v').keyUp(Key.COMMAND).perform();
    await driver.sleep(800);
    const len = await textarea.getAttribute('value').then((v) => v?.length ?? 0);
    if (len >= Math.min(80, prompt.length)) return;
  } catch {
    // fall through
  }

  const b64 = Buffer.from(prompt, 'utf8').toString('base64');
  await driver.executeScript(
    `const el = arguments[0];
     el.value = atob(arguments[1]);
     el.dispatchEvent(new Event('input', { bubbles: true }));`,
    textarea,
    b64
  );
}

async function waitForOllamaComplete(driver: WebDriver, waitMs: number): Promise<string> {
  console.log(`Waiting for Ollama response (up to ${Math.round(waitMs / 1000)}s)…`);
  const deadline = Date.now() + waitMs;
  let lastLen = 0;
  let stable = 0;

  while (Date.now() < deadline) {
    const state = await driver.executeScript(`
      const status = document.getElementById('status');
      const latex = document.getElementById('latex-output');
      const response = document.getElementById('response');
      return {
        status: status?.dataset?.status || 'idle',
        latex: (latex?.textContent || '').trim(),
        responseLen: (response?.textContent || '').length,
        error: status?.dataset?.status === 'error' ? status.textContent : ''
      };
    `);

    const s = state as {
      status: string;
      latex: string;
      responseLen: number;
      error: string;
    };

    if (s.status === 'error') {
      throw new Error(s.error || 'Ollama generation failed in browser');
    }

    if (s.status === 'complete' && s.latex.length > 80) {
      console.log(`Ollama response complete (${s.latex.length} chars LaTeX)`);
      return s.latex;
    }

    if (s.responseLen > 100 && s.responseLen === lastLen) {
      stable += 1;
      if (stable >= 4 && s.latex.length > 80) return s.latex;
    } else {
      stable = 0;
      lastLen = s.responseLen;
    }

    await driver.sleep(2000);
  }

  const partial = await driver.executeScript(`
    const latex = document.getElementById('latex-output');
    return (latex?.textContent || '').trim();
  `);
  if (typeof partial === 'string' && partial.length > 80) return partial;

  throw new Error('Timed out waiting for Ollama to finish generating LaTeX.');
}

/**
 * Generate tailored LaTeX via Ollama using Selenium on the local chat page (Green Chrome).
 * The page proxies to http://localhost:11434 — same engine as Ollama desktop.
 */
export async function generateResumeWithOllamaSelenium(
  jobDescription: string
): Promise<{ latex: string; driver: WebDriver }> {
  const prompt = buildOllamaResumePrompt(jobDescription);
  const pageUrl = ollamaPageUrl();
  const driver = await attachDriver(greenProfile(pageUrl));

  try {
    await driver.get(pageUrl);
    await driver.sleep(1500);

    const textarea = await driver.wait(until.elementLocated(By.css('#prompt')), 10000);
    await pastePrompt(driver, textarea, prompt);

    const sendBtn = await driver.findElement(By.css('#send-btn'));
    await sendBtn.click();

    const latex = await waitForOllamaComplete(driver, config.ollama.responseWaitMs);
    const parsed = extractLatexFromOllamaResponse(latex);
    console.log(`Ollama LaTeX ready (${parsed.length} chars)`);
    return { latex: parsed, driver };
  } catch (err) {
    await releaseDriver(driver);
    throw err;
  }
}

/** Direct API fallback (no browser) — used if Selenium fails. */
export async function generateResumeWithOllamaApi(jobDescription: string): Promise<string> {
  const prompt = buildOllamaResumePrompt(jobDescription);

  const res = await fetch(`${config.ollama.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama API error: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content || '';
  return extractLatexFromOllamaResponse(content);
}

export async function generateResumeWithOllama(
  jobDescription: string
): Promise<{ latex: string; driver: WebDriver | null }> {
  try {
    const result = await generateResumeWithOllamaSelenium(jobDescription);
    return { latex: result.latex, driver: result.driver };
  } catch (seleniumErr) {
    console.warn(
      'Ollama Selenium failed, trying API:',
      seleniumErr instanceof Error ? seleniumErr.message : seleniumErr
    );
    const latex = await generateResumeWithOllamaApi(jobDescription);
    return { latex, driver: null };
  }
}
