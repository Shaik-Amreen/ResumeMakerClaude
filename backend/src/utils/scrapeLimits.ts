import { config } from '../config';
import { getActiveScrapeOptions } from '../services/scrapeContext';

/** Soft ceiling used when a phase is configured as unlimited (0). */
export const UNLIMITED_SCRAPE_TARGET = 100_000;

/** 0 in config = scrape every Summer 2027 match found in this run, then stop. */
export function scrapeRunTarget(explicitCap?: number): number {
  const phaseCap = getActiveScrapeOptions()?.phaseCap;
  const cap = explicitCap ?? phaseCap ?? config.pipeline.perSourceCap ?? config.linkedin.scrapeTargetTotal;
  if (!cap || cap <= 0) return UNLIMITED_SCRAPE_TARGET;
  return cap;
}

/** FAANG portals + GitHub lists always scrape every match (no UI/pipeline cap). */
export function unlimitedScrapeTarget(): number {
  return UNLIMITED_SCRAPE_TARGET;
}

export function schedulerPortalTarget(kind: 'night' | 'priority'): number {
  const cap = kind === 'night' ? config.scheduler.nightScrapeCap : config.scheduler.priorityScrapeCap;
  if (!cap || cap <= 0) return 9999;
  return cap;
}

export function resolvePortalTarget(kind: 'night' | 'priority'): number {
  const phaseCap = getActiveScrapeOptions()?.phaseCap;
  if (phaseCap && phaseCap > 0) return phaseCap;
  return schedulerPortalTarget(kind);
}
