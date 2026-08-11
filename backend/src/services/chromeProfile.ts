import { execSync, spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Builder, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import { config } from '../config';
import { syncAuthFilesFromDailyChrome } from './cookieSync';

export type ChromeProfileKind = 'orange' | 'green';

export interface ProfileOptions {
  kind: ChromeProfileKind;
  userDataDir: string;
  profileDirectory: string;
  /** Daily Chrome folder for cookie/Login Data copy (may differ from profileDirectory). */
  sourceProfileDirectory?: string;
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
  const localStatePath = path.join(root, 'Local State');
  let state: Record<string, any> = {
    profile: {
      info_cache: { [profileDirectory]: { name: profileDirectory } },
      last_used: profileDirectory,
    },
  };
  if (fs.existsSync(localStatePath)) {
    try {
      state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    } catch {
      // rewrite below
    }
  }
  state.profile = state.profile || {};
  state.profile.info_cache = state.profile.info_cache || {};
  if (!state.profile.info_cache[profileDirectory]) {
    state.profile.info_cache[profileDirectory] = { name: profileDirectory };
  }
  // Always force the automation profile so Chrome never opens Default / Profile 26 by accident.
  state.profile.last_used = profileDirectory;
  state.profile.last_active_profiles = [profileDirectory];
  fs.writeFileSync(localStatePath, JSON.stringify(state));
  return root;
}

function readLastUsedProfile(userDataDir: string): string | null {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'));
    return state?.profile?.last_used || null;
  } catch {
    return null;
  }
}

/** Actual --profile-directory from the live Chrome process (Local State can lie while Chrome is open). */
function readRunningProfileDirectory(userDataDir: string): string | null {
  try {
    const result = execSync(`pgrep -f "${userDataDir}"`, { encoding: 'utf8' }).trim();
    for (const pid of result.split('\n')) {
      if (!pid) continue;
      try {
        const cmdline = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' });
        // Profile dirs may contain spaces: "--profile-directory=Profile 1"
        const m = cmdline.match(/--profile-directory=(?:"([^"]+)"|([^\s-][^]*?)(?=\s+--|\s*$))/);
        if (m) return (m[1] || m[2] || '').trim() || null;
      } catch {
        // process may have exited
      }
    }
  } catch {
    // no matching process
  }
  return null;
}

function resolveSourceProfile(options: ProfileOptions): string {
  if (options.sourceProfileDirectory) return options.sourceProfileDirectory;
  if (options.kind === 'orange') return config.linkedin.sourceProfileDirectory;
  return options.profileDirectory;
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
  // Do NOT pkill chromedriver globally — orange apply + green Claude run concurrently
  // and each Selenium session needs its own chromedriver bridge.
}

export async function launchChrome(options: ProfileOptions): Promise<boolean> {
  if (!fs.existsSync(CHROME_APP)) {
    throw new Error(`Chrome not found at ${CHROME_APP}. Set CHROME_BINARY in .env`);
  }

  const userDataDir = path.resolve(options.userDataDir);
  const sourceProfile = resolveSourceProfile(options);

  const alreadyReady =
    (await isChromeDebugReady(options.debugPort)) && (await chromeHasOpenPages(options.debugPort));
  // Prefer live process args — Local State last_used can be rewritten while the wrong profile is still open.
  const runningProfile = readRunningProfileDirectory(userDataDir);
  const lastUsed = runningProfile || readLastUsedProfile(userDataDir);
  if (alreadyReady && lastUsed === options.profileDirectory) {
    console.log(
      `Chrome ready on port ${options.debugPort} (${options.kind}, ${options.profileDirectory})`
    );
    return true;
  }
  if (alreadyReady && lastUsed !== options.profileDirectory) {
    console.log(
      `Chrome on port ${options.debugPort} is using ${lastUsed || 'unknown'} — restarting as ${options.profileDirectory}`
    );
  }

  console.log(
    `Starting ${options.kind} Chrome on port ${options.debugPort} (${options.profileDirectory})...`
  );
  stopChromeForUserData(userDataDir);
  await delay(1500);

  ensureProfileDir(userDataDir, options.profileDirectory);
  syncAuthFilesFromDailyChrome(sourceProfile, userDataDir, options.profileDirectory);

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
      console.log(
        `Chrome started on port ${options.debugPort} (${options.kind}, ${options.profileDirectory})`
      );
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
