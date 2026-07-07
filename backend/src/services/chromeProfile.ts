import { execSync, spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import { syncAuthFilesFromDailyChrome } from './cookieSync';

export type ChromeProfileKind = 'orange' | 'green';

export interface ProfileOptions {
  kind: ChromeProfileKind;
  userDataDir: string;
  profileDirectory: string;
  debugPort: number;
  headless?: boolean;
  startUrl?: string;
}

const CHROME_APP =
  process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureProfileDir(userDataDir: string, profileDirectory: string) {
  const root = path.resolve(userDataDir);
  fs.mkdirSync(path.join(root, profileDirectory), { recursive: true });
  const localState = path.join(root, 'Local State');
  if (!fs.existsSync(localState)) {
    fs.writeFileSync(
      localState,
      JSON.stringify({
        profile: {
          info_cache: { [profileDirectory]: { name: profileDirectory } },
          last_used: profileDirectory,
        },
      })
    );
  }
  return root;
}

function fetchDebug(port: number, endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: endpoint, timeout: 4000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function isChromeDebugReady(port: number): Promise<boolean> {
  try {
    const body = await fetchDebug(port, '/json/version');
    return body.includes('Browser') || body.includes('webSocketDebuggerUrl');
  } catch {
    return false;
  }
}

async function chromeHasOpenPages(port: number): Promise<boolean> {
  try {
    const body = await fetchDebug(port, '/json/list');
    const pages = JSON.parse(body) as unknown[];
    return Array.isArray(pages) && pages.length > 0;
  } catch {
    return false;
  }
}

function stopChromeForUserData(userDataDir: string) {
  try {
    const result = execSync(`pgrep -f "${userDataDir}"`, { encoding: 'utf8' }).trim();
    for (const pid of result.split('\n')) {
      if (pid) execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
  } catch {
    // no matching process
  }
  try {
    execSync('pkill -9 -f chromedriver', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

export async function launchChrome(options: ProfileOptions): Promise<boolean> {
  if (!fs.existsSync(CHROME_APP)) {
    throw new Error(`Chrome not found at ${CHROME_APP}. Set CHROME_BINARY in .env`);
  }

  const userDataDir = ensureProfileDir(options.userDataDir, options.profileDirectory);

  if ((await isChromeDebugReady(options.debugPort)) && (await chromeHasOpenPages(options.debugPort))) {
    console.log(`Chrome ready on port ${options.debugPort} (${options.kind})`);
    return true;
  }

  console.log(`Starting ${options.kind} Chrome on port ${options.debugPort}...`);
  stopChromeForUserData(userDataDir);
  await delay(1500);

  syncAuthFilesFromDailyChrome(options.profileDirectory, userDataDir);

  const args = [
    `--remote-debugging-port=${options.debugPort}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${options.profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--window-size=1400,900',
    '--disable-blink-features=AutomationControlled',
  ];

  if (options.headless) {
    args.push('--headless=new');
  }

  args.push(options.startUrl || 'about:blank');

  spawn(CHROME_APP, args, { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < 60; i++) {
    if ((await isChromeDebugReady(options.debugPort)) && (await chromeHasOpenPages(options.debugPort))) {
      console.log(`Chrome started on port ${options.debugPort} (${options.kind})`);
      return true;
    }
    await delay(500);
  }

  return false;
}

export async function attachDriver(options: ProfileOptions): Promise<WebDriver> {
  const ready = await launchChrome(options);
  if (!ready) {
    throw new Error(
      `Chrome did not start for ${options.kind} profile on port ${options.debugPort}. Close conflicting Chrome windows and retry.`
    );
  }

  await delay(1000);

  const driverOptions = new chrome.Options();
  driverOptions.debuggerAddress(`127.0.0.1:${options.debugPort}`);

  return new Builder().forBrowser('chrome').setChromeOptions(driverOptions).build();
}

/** Detach Selenium only — do NOT quit() or Chrome on the debug port will close. */
export async function releaseDriver(driver: WebDriver | null) {
  if (!driver) return;
  try {
    await driver.getSession();
  } catch {
    // session already ended
  }
}

/** @deprecated use releaseDriver — quit() kills automation Chrome on debug port */
export async function quitDriver(driver: WebDriver | null) {
  await releaseDriver(driver);
}
