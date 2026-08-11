import { isStopRequested } from './taskStatusService';

export interface ScrapeRunOptions {
  skipAutoResume?: boolean;
  shouldStop?: () => boolean;
  /** Cap new jobs for the active scrape phase (0 / undefined = unlimited soft ceiling). */
  phaseCap?: number;
}

let active: ScrapeRunOptions | null = null;

export function getActiveScrapeOptions(): ScrapeRunOptions | null {
  return active;
}

export function beginScrapeRun(options: ScrapeRunOptions) {
  active = { ...options };
}

export function endScrapeRun() {
  active = null;
}

export async function withScrapeRun<T>(options: ScrapeRunOptions, fn: () => Promise<T>): Promise<T> {
  beginScrapeRun(options);
  try {
    return await fn();
  } finally {
    endScrapeRun();
  }
}

export function shouldSkipAutoResume(): boolean {
  return active?.skipAutoResume === true;
}

export function shouldAbortScrape(): boolean {
  const opts = getActiveScrapeOptions();
  if (opts?.shouldStop && opts.shouldStop !== shouldAbortScrape && opts.shouldStop()) return true;
  return isStopRequested();
}

/** Sleep in small chunks so Stop can interrupt long waits. */
export async function scrapeSleep(ms: number): Promise<void> {
  const step = 400;
  let elapsed = 0;
  while (elapsed < ms) {
    if (shouldAbortScrape()) return;
    const chunk = Math.min(step, ms - elapsed);
    await new Promise((r) => setTimeout(r, chunk));
    elapsed += chunk;
  }
}
