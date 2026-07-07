import { config } from '../config';

/** 0 in config = scrape every Summer 2027 match found in this run, then stop. */
export function scrapeRunTarget(explicitCap?: number): number {
  const cap = explicitCap ?? config.linkedin.scrapeTargetTotal;
  if (!cap || cap <= 0) return 9999;
  return cap;
}

export function schedulerPortalTarget(kind: 'night' | 'priority'): number {
  const cap = kind === 'night' ? config.scheduler.nightScrapeCap : config.scheduler.priorityScrapeCap;
  if (!cap || cap <= 0) return 9999;
  return cap;
}

export function isUnlimitedCap(cap: number): boolean {
  return cap >= 9999;
}
