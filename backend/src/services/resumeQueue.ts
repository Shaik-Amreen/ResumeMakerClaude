import { runResumePipeline } from './resumePipeline';

/** Serial queue — only one resume pipeline at a time. */
let resumeChain: Promise<unknown> = Promise.resolve();
const queuedByJob = new Map<string, Promise<unknown>>();

export function enqueueResume(jobId: string): Promise<unknown> {
  const existing = queuedByJob.get(jobId);
  if (existing) return existing;

  const task = resumeChain.then(() => runResumePipeline(jobId));
  queuedByJob.set(jobId, task);

  // Keep the serial tail usable after a failure, while returning the rejecting
  // task to the caller so task status cannot incorrectly report success.
  resumeChain = task.catch((err) => {
    console.error(`Resume pipeline failed for ${jobId}:`, err);
  });

  void task
    .finally(() => {
      if (queuedByJob.get(jobId) === task) queuedByJob.delete(jobId);
    })
    .catch(() => undefined);

  return task;
}

export function isResumeQueueIdle(): boolean {
  return queuedByJob.size === 0;
}
