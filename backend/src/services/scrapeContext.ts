import { isStopRequested } from './taskStatusService';

/** Per-run scrape settings for the master pipeline (phase caps, no auto-resume). */
export interface ScrapeRunOptions {
  /** Max new jobs to save in this scrape phase (default from env or 50). */
  phaseCap?: number;
  /** When true, saveJobIfNew will not auto-enqueue resume generation. */
  skipAutoResume?: boolean;
  /** Check between cards — return true to stop this scrape phase. */
  shouldStop?: () => boolean;
}

let active: ScrapeRunOptions | null = null;

export function getActiveScrapeOptions(): ScrapeRunOptions | null {
  return active;
}

export function beginScrapeRun(options: ScrapeRunOptions): void {
  active = { ...options };
}

export function endScrapeRun(): void {
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
