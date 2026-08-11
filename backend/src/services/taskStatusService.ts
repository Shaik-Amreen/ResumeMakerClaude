export type TaskKind =
  | 'idle'
  | 'scraping_jobright'
  | 'scraping_linkedin'
  | 'scraping_indeed'
  | 'scraping_career_portals'
  | 'scraping_faang_portals'
  | 'scraping_github_lists'
  | 'scraping_ats'
  | 'scraping_scoutify'
  | 'generating_resumes'
  | 'master_pipeline'
  | 'applying_career'
  | 'outreach';

export interface TaskProgress {
  current: number;
  total: number;
  label?: string;
}

export interface TaskStatus {
  active: boolean;
  task: TaskKind;
  phase?: string;
  message: string;
  progress?: TaskProgress;
  scrapedThisRun: number;
  resumesDone: number;
  resumesTotal: number;
  lastError?: string;
  logs: string[];
  stopRequested: boolean;
  startedAt?: string;
  updatedAt: string;
}

const MAX_LOGS = 80;

let status: TaskStatus = freshStatus();

function freshStatus(): TaskStatus {
  return {
    active: false,
    task: 'idle',
    message: 'Idle — ready to scrape or generate resumes.',
    scrapedThisRun: 0,
    resumesDone: 0,
    resumesTotal: 0,
    logs: [],
    stopRequested: false,
    updatedAt: new Date().toISOString(),
  };
}

function touch(partial: Partial<TaskStatus>) {
  status = { ...status, ...partial, updatedAt: new Date().toISOString() };
}

export function getTaskStatus(): TaskStatus {
  return { ...status, logs: [...status.logs] };
}

export function appendTaskLog(line: string) {
  const logs = [...status.logs, line].slice(-MAX_LOGS);
  const keepMessage = status.stopRequested && status.active;
  touch({
    logs,
    ...(keepMessage ? {} : { message: line }),
  });
  console.log(line);
}

/** Update the live status message + activity log with the URL currently being opened. */
export function logScrapingUrl(url: string, label?: string) {
  const short = url.length > 120 ? `${url.slice(0, 117)}…` : url;
  const line = label ? `🔗 ${label}: ${short}` : `🔗 Opening: ${short}`;
  appendTaskLog(line);
}

export function requestTaskStop(): void {
  if (status.stopRequested && status.active) return;
  touch({
    stopRequested: true,
    message: 'Stopping — halting after current step…',
    phase: 'stopping',
  });
  appendTaskLog('⏹ Stop requested by user');
}

export function isStopRequested(): boolean {
  return status.stopRequested;
}

export function clearStopRequest(): void {
  touch({ stopRequested: false });
}

export function startTask(task: TaskKind, message: string, phase?: string) {
  status = {
    ...freshStatus(),
    active: true,
    task,
    phase,
    message,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  appendTaskLog(`▶ ${message}`);
}

export function setTaskPhase(phase: string, message?: string) {
  touch({ phase, ...(message ? { message } : {}) });
  if (message) appendTaskLog(message);
}

export function setTaskProgress(current: number, total: number, label?: string) {
  touch({
    progress: { current, total, label },
    message: label || status.message,
  });
}

export function incrementScraped(count = 1) {
  touch({ scrapedThisRun: status.scrapedThisRun + count });
}

export function setResumeProgress(done: number, total: number) {
  touch({
    resumesDone: done,
    resumesTotal: total,
    progress: { current: done, total, label: `Resume ${done}/${total}` },
    message: `Generating resume ${done}/${total}…`,
  });
}

export function setTaskError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  touch({ lastError: msg, message: `Error: ${msg}` });
  appendTaskLog(`❌ ${msg}`);
}

export function finishTask(message: string) {
  appendTaskLog(`✅ ${message}`);
  touch({
    active: false,
    task: 'idle',
    message,
    stopRequested: false,
    progress: undefined,
  });
}

export function abortTask(message: string) {
  appendTaskLog(`⏹ ${message}`);
  touch({
    active: false,
    task: 'idle',
    message,
    stopRequested: false,
    phase: undefined,
    progress: undefined,
  });
}

/** Mark UI idle but keep stopRequested so in-flight scrapes still exit. */
export function markStoppedKeepAbort(message: string) {
  appendTaskLog(`⏹ ${message}`);
  touch({
    active: false,
    task: 'idle',
    message,
    stopRequested: true,
    phase: undefined,
    progress: undefined,
  });
}

export function isTaskActive(): boolean {
  return status.active;
}
