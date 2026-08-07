import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'resume-debug.log');

function cleanMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (/key|token|secret|authorization/i.test(key)) continue;
    if (typeof value === 'string') cleaned[key] = value.length > 500 ? `${value.slice(0, 500)}...` : value;
    else cleaned[key] = value;
  }
  return cleaned;
}

export function makeTraceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function traceLog(traceId: string, event: string, meta?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    traceId,
    event,
    ...(cleanMeta(meta) ? { meta: cleanMeta(meta) } : {}),
  };
  const line = JSON.stringify(entry);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    // Debug logging must never break resume generation.
  }
  console.log(`[resume-trace ${traceId}] ${event}${meta ? ` ${JSON.stringify(cleanMeta(meta))}` : ''}`);
}

export function traceError(traceId: string, event: string, err: unknown, meta?: Record<string, unknown>) {
  const message = err instanceof Error ? err.message : String(err);
  traceLog(traceId, event, {
    ...meta,
    error: message,
    name: err instanceof Error ? err.name : undefined,
  });
}
