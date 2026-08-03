import { config } from '../config';
import { isPipelineRunning, isScrapeRunning, runMasterPipeline } from './orchestratorService';

/** Continuous Summer 2027 internship cycles (scrape → resume → LinkedIn Easy Apply with approval). */
export type ScheduleWindow = 'internship_cycle' | 'idle';

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

let running = false;
let lastCycleEndedAt = 0;

/** Cooldown between full internship cycles (default 2 hours). */
function cycleCooldownMs(): number {
  const hours = Number(process.env.SCHEDULER_CYCLE_HOURS) || 2;
  return Math.max(0.25, hours) * 60 * 60 * 1000;
}

/** Call after any manual scrape/stop so the auto cycle does not start immediately. */
export function noteManualActivity() {
  lastCycleEndedAt = Date.now();
}

async function runInternshipCycle() {
  if (running || isScrapeRunning() || isPipelineRunning()) return;
  running = true;

  try {
    console.log(`\n⏰ Scheduler [${config.scheduler.timezone}] — Summer 2027 internship cycle`);
    console.log('   FAANG → GitHub → Jobright → LinkedIn → Google → ATS (shared cap) → resumes (no Easy Apply)');

    await runMasterPipeline({
      deleteFirst: false,
      perSourceCap: config.pipeline.perSourceCap,
      jobType: 'internship',
    });

    console.log('\n✅ Internship cycle complete — waiting for cooldown before next run.');
  } catch (err) {
    console.error('Scheduler internship cycle failed:', err);
  } finally {
    lastCycleEndedAt = Date.now();
    running = false;
  }
}

function tick() {
  if (!config.scheduler.enabled) return;
  if (running || isScrapeRunning() || isPipelineRunning()) return;

  const since = Date.now() - lastCycleEndedAt;
  if (lastCycleEndedAt > 0 && since < cycleCooldownMs()) return;

  runInternshipCycle().catch(console.error);
}

export function currentWindow(): ScheduleWindow {
  if (!config.scheduler.enabled) return 'idle';
  if (running) return 'internship_cycle';
  return 'internship_cycle';
}

export function startJobScheduler() {
  if (!config.scheduler.enabled) {
    console.log('Job scheduler disabled (set SCHEDULER_ENABLED=true in .env to enable auto cycles)');
    return;
  }

  const { hour, minute } = pacificHourMinute();
  const cooldownH = Number(process.env.SCHEDULER_CYCLE_HOURS) || 2;
  console.log(
    `Job scheduler on (${config.scheduler.timezone}) — now ${hour}:${String(minute).padStart(2, '0')}`
  );
  console.log('  24/7 Summer 2027 mode:');
  console.log('    Jobright → LinkedIn → Google Jobs (50 each)');
  console.log('    Generate resumes one-by-one');
  console.log('    LinkedIn Easy Apply (you approve message + Submit)');
  console.log('    FAANG/MANGO: email alert only — never auto-apply');
  console.log(`  Cooldown between cycles: ${cooldownH}h`);

  // Start first cycle shortly after boot
  setTimeout(() => tick(), 5000);
  setInterval(tick, config.scheduler.checkIntervalMs);
}

export function getSchedulerStatus() {
  const { hour, minute } = pacificHourMinute();
  const cooldown = cycleCooldownMs();
  const remaining =
    lastCycleEndedAt > 0 ? Math.max(0, cooldown - (Date.now() - lastCycleEndedAt)) : 0;
  return {
    enabled: config.scheduler.enabled,
    timezone: config.scheduler.timezone,
    localTime: `${hour}:${String(minute).padStart(2, '0')}`,
    currentWindow: running ? ('internship_cycle' as const) : ('idle' as const),
    running,
    windowCompleted: !running && lastCycleEndedAt > 0,
    cooldownMinutesRemaining: Math.ceil(remaining / 60000),
  };
}
