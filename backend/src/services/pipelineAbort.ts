import { config } from '../config';

/** Thrown when a resume pipeline job is cancelled (user stop or batch timeout). */
export class PipelineAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineAbortError';
  }
}

export function isPipelineAbortError(err: unknown): err is PipelineAbortError {
  return err instanceof PipelineAbortError;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = typeof signal.reason === 'string' ? signal.reason : 'Pipeline aborted';
  throw new PipelineAbortError(reason);
}

/** Per-job batch timeout: Claude/Ollama LLM window + compile/revise buffer. */
export function pipelineJobTimeoutMs(): number {
  const configured = Number(process.env.JOB_PIPELINE_TIMEOUT_MS);
  if (configured > 0) return configured;

  const compileBufferMs = Number(process.env.JOB_PIPELINE_COMPILE_BUFFER_MS) || 10 * 60 * 1000;
  const { claudeCode } = config.resumeAgent;
  const llmMs = Math.max(claudeCode.timeoutMs, config.ollama.responseWaitMs);
  return llmMs + compileBufferMs;
}
