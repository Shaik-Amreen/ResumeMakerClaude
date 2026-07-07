import { config } from '../config';
import { scrapePriorityCareerPortals } from './careerPortalScraper';
import { isScrapeRunning, runFullTimeScrapeOnly } from './orchestratorService';

export type ScheduleWindow = 'night_faang_mango' | 'morning_faang_mango' | 'fulltime_jobs' | 'idle';

function pacificHourMinute(): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: config.scheduler.timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

/**
 * 11 PM–8 AM  → FAANG + MANGOES career portals (internships)
 * 9 AM–11 AM  → FAANG + MANGOES career portals (internships)
 * 8–9 AM & 11 AM–11 PM → full-time jobs (Jobright → LinkedIn → Indeed)
 */
export function currentWindow(): ScheduleWindow {
  const { hour } = pacificHourMinute();

  if (hour >= 23 || hour < 8) return 'night_faang_mango';
  if (hour >= 9 && hour < 11) return 'morning_faang_mango';
  if (hour === 8 || hour >= 11) return 'fulltime_jobs';

  return 'idle';
}

let running = false;
let activeWindow: ScheduleWindow | null = null;
let completedWindow: ScheduleWindow | null = null;

async function runWindow(window: ScheduleWindow) {
  if (running || isScrapeRunning()) return;
  running = true;

  try {
    console.log(`\n⏰ Scheduler [${config.scheduler.timezone}] — ${window}`);

    if (window === 'night_faang_mango' || window === 'morning_faang_mango') {
      console.log('   FAANG + MANGOES career portals — Summer 2027 software interns, then stop.');
      await scrapePriorityCareerPortals();
    } else if (window === 'fulltime_jobs') {
      console.log('   Full-time software roles — Jobright → LinkedIn → Indeed, then stop.');
      await runFullTimeScrapeOnly();
    }

    completedWindow = window;
    console.log(`\n✅ Window complete (${window}) — scheduler idle until next window.`);
  } catch (err) {
    console.error('Scheduler run failed:', err);
  } finally {
    running = false;
  }
}

function tick() {
  const window = currentWindow();
  if (window === 'idle') {
    activeWindow = null;
    return;
  }

  if (window !== activeWindow) {
    activeWindow = window;
    completedWindow = null;
  }

  if (running || completedWindow === window || isScrapeRunning()) return;

  runWindow(window).catch(console.error);
}

export function startJobScheduler() {
  if (!config.scheduler.enabled) {
    console.log('Job scheduler disabled (set SCHEDULER_ENABLED=true in .env)');
    return;
  }

  const { hour, minute } = pacificHourMinute();
  console.log(
    `Job scheduler on (${config.scheduler.timezone}) — now ${hour}:${String(minute).padStart(2, '0')}`
  );
  console.log('  11 PM–8 AM     → FAANG + MANGOES career portals (internships)');
  console.log('  9 AM–11 AM     → FAANG + MANGOES career portals (internships)');
  console.log('  8–9 AM & 11 AM–11 PM → full-time jobs (Jobright → LinkedIn → Indeed)');
  console.log('  Each window runs once, scrapes all matches, then stops.');

  tick();
  setInterval(tick, config.scheduler.checkIntervalMs);
}

export function getSchedulerStatus() {
  const { hour, minute } = pacificHourMinute();
  const window = currentWindow();
  return {
    enabled: config.scheduler.enabled,
    timezone: config.scheduler.timezone,
    localTime: `${hour}:${String(minute).padStart(2, '0')}`,
    currentWindow: window,
    running,
    windowCompleted: completedWindow === window && !running,
  };
}
