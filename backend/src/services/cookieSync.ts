import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WebDriver } from 'selenium-webdriver';
import { config } from '../config';

const DAILY_CHROME_USER_DATA = path.join(
  os.homedir(),
  'Library/Application Support/Google/Chrome'
);

const AUTH_FILES = [
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Login Data-journal',
  'Web Data',
  'Web Data-journal',
  'Account Web Data',
  'Account Web Data-journal',
];

function getChromeCookieKey(): string | null {
  const fromEnv = process.env.SOCIAL_CHROME_KEYCHAIN_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  const attempts = [
    ['security', 'find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
    ['security', 'find-generic-password', '-w', '-s', 'Chrome Safe Storage'],
    ['security', 'find-generic-password', '-w', '-a', 'Chrome', '-s', 'Chrome Safe Storage'],
  ];

  for (const args of attempts) {
    try {
      const pwd = execSync(args.join(' '), { encoding: 'utf8' }).trim();
      if (pwd) return pwd;
    } catch {
      // try next
    }
  }

  console.warn(
    'Chrome cookie key not found. Set SOCIAL_CHROME_KEYCHAIN_PASSWORD in .env or allow Keychain access.'
  );
  return null;
}

function decryptChromeCookieValue(encrypted: Buffer, key: Buffer): string | null {
  if (!encrypted.length) return null;

  if (encrypted.subarray(0, 3).toString() === 'v10') {
    const iv = encrypted.subarray(3, 19);
    const data = encrypted.subarray(19);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const pad = decrypted[decrypted.length - 1];
    if (pad >= 1 && pad <= 16) {
      decrypted = decrypted.subarray(0, decrypted.length - pad);
    }
    if (decrypted.length >= 16) {
      decrypted = decrypted.subarray(16);
    }
    return decrypted.toString('utf8');
  }

  return encrypted.toString('utf8');
}

/**
 * Copy Google/LinkedIn auth state from your daily Chrome profile into automation Chrome.
 * Close automation Chrome before calling. Daily Chrome can stay open for read-only cookie copy.
 */
export function syncAuthFilesFromDailyChrome(
  sourceProfileDirectory: string,
  automationUserDataDir: string
): boolean {
  const srcDir = path.join(DAILY_CHROME_USER_DATA, sourceProfileDirectory);
  const dstDir = path.join(automationUserDataDir, sourceProfileDirectory);

  if (!fs.existsSync(srcDir)) {
    console.error(`Daily Chrome profile not found: ${srcDir}`);
    return false;
  }

  fs.mkdirSync(dstDir, { recursive: true });
  const copied: string[] = [];

  for (const name of AUTH_FILES) {
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(dstDir, name));
      copied.push(name);
    } catch (err) {
      console.warn(`Could not copy ${name}:`, err);
    }
  }

  if (copied.length) {
    console.log(`Synced auth files → automation (${sourceProfileDirectory}): ${copied.join(', ')}`);
    return true;
  }

  console.error(`No auth files copied from ${sourceProfileDirectory}`);
  return false;
}

export async function injectCookiesFromDailyChrome(
  driver: WebDriver,
  domainKeyword: string,
  targetUrl: string,
  sourceProfileDirectory: string
): Promise<boolean> {
  const keychainPwd = getChromeCookieKey();
  if (!keychainPwd) return false;

  const cookieDb = path.join(DAILY_CHROME_USER_DATA, sourceProfileDirectory, 'Cookies');
  if (!fs.existsSync(cookieDb)) {
    console.error(`Cookie DB not found: ${cookieDb}`);
    return false;
  }

  let Database: typeof import('better-sqlite3');
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    console.error('Install better-sqlite3: npm install better-sqlite3');
    return false;
  }

  const tmpDb = path.join(os.tmpdir(), `chrome-cookies-${Date.now()}.db`);
  fs.copyFileSync(cookieDb, tmpDb);

  const aesKey = crypto.pbkdf2Sync(keychainPwd, 'saltysalt', 1003, 16, 'sha1');
  const db = new Database(tmpDb, { readonly: true });

  const rows = db
    .prepare(
      `SELECT host_key, name, encrypted_value, path, is_secure, expires_utc
       FROM cookies WHERE host_key LIKE ?`
    )
    .all(`%${domainKeyword}%`) as Array<{
    host_key: string;
    name: string;
    encrypted_value: Buffer;
    path: string;
    is_secure: number;
    expires_utc: number;
  }>;

  db.close();
  fs.unlinkSync(tmpDb);

  const cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    expiry?: number;
  }> = [];

  for (const row of rows) {
    try {
      const value = decryptChromeCookieValue(row.encrypted_value, aesKey);
      if (!value) continue;
      const cookie: (typeof cookies)[number] = {
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path || '/',
        secure: Boolean(row.is_secure),
      };
      if (row.expires_utc) {
        const unix = Math.floor(row.expires_utc / 1_000_000) - 11_644_473_600;
        if (unix > 0) cookie.expiry = unix;
      }
      cookies.push(cookie);
    } catch {
      // skip bad cookie
    }
  }

  console.log(`Read ${cookies.length} cookies from ${sourceProfileDirectory} for ${domainKeyword}`);
  if (!cookies.length) return false;

  const seedUrl = domainKeyword.includes('.')
    ? `https://${domainKeyword}/robots.txt`
    : `https://www.${domainKeyword}/robots.txt`;

  await driver.get(seedUrl);
  await driver.sleep(1000);

  let injected = 0;
  for (const cookie of cookies) {
    try {
      await driver.manage().addCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        ...(cookie.expiry ? { expiry: cookie.expiry } : {}),
      });
      injected += 1;
    } catch {
      // some cookies won't attach cross-domain
    }
  }

  console.log(`Injected ${injected} cookies — opening ${targetUrl}`);
  await driver.get(targetUrl);
  await driver.sleep(3000);
  return injected > 0;
}

export async function syncOrangeSession(driver: WebDriver, targetUrl: string): Promise<void> {
  const { linkedin } = config;
  await injectCookiesFromDailyChrome(driver, 'linkedin.com', targetUrl, linkedin.profileDirectory);
}

export async function syncGreenSession(driver: WebDriver, targetUrl: string): Promise<void> {
  const profile = config.chatgpt.profileDirectory;

  for (const domain of ['chatgpt.com', 'openai.com', 'claude.ai', 'anthropic.com']) {
    try {
      await injectCookiesFromDailyChrome(driver, domain, targetUrl, profile);
    } catch {
      // domain may have no cookies
    }
  }

  await driver.get(targetUrl);
  await driver.sleep(2000);
}
