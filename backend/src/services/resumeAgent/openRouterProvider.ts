import { config } from '../../config';
import {
  buildResumeSystemPrompt,
  buildResumeUserPrompt,
  type ResumeJobContext,
} from '../resumeTailoringPrompt';
import { parseModelResumeResponse, type LlmMatchReport } from './extractLatex';
import { makeTraceId, traceError, traceLog } from '../debugTrace';
import {
  extractRoutedModel,
  extractRoutedModelFromHeaders,
  formatLlmLabel,
  logLlmInUse,
  type LlmGateway,
} from './llmRoute';

export type { LlmMatchReport };

export interface ResumeGenerationResult {
  latex: string;
  llmMatch?: LlmMatchReport;
  usedProvider?: string;
}

export type LlmModelCallback = (info: {
  gateway: LlmGateway;
  requested: string;
  routed: string;
  label: string;
}) => void;

interface OpenRouterChatResponse {
  model?: string;
  provider?: string;
  choices?: Array<{
    model?: string;
    message?: { content?: string };
    delta?: { content?: string; reasoning_content?: string };
  }>;
  error?: { message?: string };
  [key: string]: unknown;
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function gatewayForBaseUrl(baseUrl: string): LlmGateway {
  return /20128|omniroute/i.test(baseUrl) ? 'OmniRoute' : 'OpenRouter';
}

function isOmniRoute(): boolean {
  return gatewayForBaseUrl(config.resumeAgent.openRouter.baseUrl) === 'OmniRoute';
}

/** Time (ms) to wait for the next SSE chunk before declaring the stream hung. */
const SSE_READ_TIMEOUT_MS = 60_000;

/** Parse OpenAI-compatible SSE (`data: {...}`) into assistant text. */
async function readSseChatContent(
  res: Response,
  traceId: string,
  onChunkMeta?: (chunk: unknown) => void
): Promise<string> {
  if (!res.body) throw new Error('OpenRouter/OmniRoute stream had no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let chunkCount = 0;
  let lastLogAt = Date.now();
  traceLog(traceId, 'openrouter.sse.start');

  while (true) {
    // Race each read against a per-chunk timeout so a stalled stream cannot
    // hang the pipeline indefinitely (the outer AbortController only covers
    // the fetch itself, not individual reader.read() calls on some runtimes).
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(
        () => reject(new Error(`SSE stream stalled — no data for ${SSE_READ_TIMEOUT_MS / 1000}s`)),
        SSE_READ_TIMEOUT_MS
      );
      // Let the timer be GC'd if the read finishes first.
      readPromise.then(() => clearTimeout(id), () => clearTimeout(id));
    });

    const { done, value } = await Promise.race([readPromise, timeoutPromise]);
    if (done) break;
    chunkCount += 1;
    if (Date.now() - lastLogAt > 10_000) {
      traceLog(traceId, 'openrouter.sse.progress', { chunkCount, contentChars: content.length });
      lastLogAt = Date.now();
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let chunk: OpenRouterChatResponse;
      try {
        chunk = JSON.parse(payload) as OpenRouterChatResponse;
      } catch {
        continue;
      }
      if (chunk.error?.message) {
        throw new Error(`OpenRouter stream error: ${chunk.error.message}`);
      }
      onChunkMeta?.(chunk);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
      const full = chunk.choices?.[0]?.message?.content;
      if (typeof full === 'string' && full && !delta) content = full;
    }
  }

  traceLog(traceId, 'openrouter.sse.done', { chunkCount, contentChars: content.length });
  return content;
}

/**
 * Chat completion against OpenRouter or OmniRoute.
 * OmniRoute's non-stream path often 503s / hangs — prefer SSE and assemble text.
 */
export async function openRouterChatCompletion(
  messages: ChatMessage[],
  opts?: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    traceId?: string;
    signal?: AbortSignal;
    work?: string;
    onModel?: LlmModelCallback;
    /** Skip the built-in console line (caller logs when the label changes). */
    silent?: boolean;
  }
): Promise<string> {
  const { openRouter } = config.resumeAgent;
  const apiKey = opts?.apiKey || openRouter.apiKey;
  const baseUrl = opts?.baseUrl || openRouter.baseUrl;
  const traceId = opts?.traceId || makeTraceId('openrouter');
  const requested = opts?.model ?? openRouter.model;
  const gateway = gatewayForBaseUrl(baseUrl);
  const work = opts?.work || 'LLM';

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY (or opts.apiKey) is not set');
  }

  const useStream = true;
  let lastRouted = '';
  const noteModel = (routed: string | undefined) => {
    const resolved = (routed || requested).trim();
    if (!resolved || resolved === lastRouted) return;
    lastRouted = resolved;
    const label = formatLlmLabel({ gateway, requested, routed: resolved });
    if (!opts?.silent) logLlmInUse(work, label);
    traceLog(traceId, 'openrouter.model', { gateway, requested, routed: resolved, label });
    opts?.onModel?.({ gateway, requested, routed: resolved, label });
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const requestStart = Date.now();
  const url = `${baseUrl}/chat/completions`;
  noteModel(requested);
  traceLog(traceId, 'openrouter.fetch.start', {
    url,
    model: requested,
    maxTokens: opts?.maxTokens ?? openRouter.maxTokens,
    temperature: opts?.temperature ?? openRouter.temperature,
    stream: useStream,
    messageCount: messages.length,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: useStream ? 'text/event-stream' : 'application/json',
        'HTTP-Referer': openRouter.siteUrl,
        'X-Title': openRouter.appName,
      },
      body: JSON.stringify({
        model: requested,
        messages,
        max_tokens: opts?.maxTokens ?? openRouter.maxTokens,
        temperature: opts?.temperature ?? openRouter.temperature,
        stream: useStream,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    traceError(traceId, 'openrouter.fetch.failed-before-response', err);
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  traceLog(traceId, 'openrouter.fetch.response', {
    status: res.status,
    ok: res.ok,
    contentType,
    elapsedMs: Date.now() - requestStart,
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 400);
    let recovery = '';
    try {
      const errJson = JSON.parse(text) as OpenRouterChatResponse & {
        recovery_hint?: { next_step?: string };
        diagnostics?: { recovery?: { next_step?: string } };
      };
      if (errJson.error?.message) msg = errJson.error.message;
      recovery =
        errJson.recovery_hint?.next_step ||
        errJson.diagnostics?.recovery?.next_step ||
        '';
    } catch {
      /* keep raw */
    }
    const hint = recovery ? ` — ${recovery}` : '';
    const err = new Error(`OpenRouter error (${res.status}): ${msg}${hint}`);
    traceError(traceId, 'openrouter.fetch.error-response', err, { status: res.status });
    throw err;
  }

  try {
    let content = '';
    noteModel(extractRoutedModelFromHeaders(res.headers));
    if (useStream || contentType.includes('text/event-stream')) {
      content = await readSseChatContent(res, traceId, (chunk) => {
        noteModel(extractRoutedModel(chunk));
      });
    } else {
      traceLog(traceId, 'openrouter.json.start');
      const data = (await res.json()) as OpenRouterChatResponse;
      if (data.error?.message) {
        throw new Error(`OpenRouter error: ${data.error.message}`);
      }
      noteModel(extractRoutedModel(data));
      content = data.choices?.[0]?.message?.content || '';
      traceLog(traceId, 'openrouter.json.done', { contentChars: content.length });
    }

    if (!content.trim()) {
      throw new Error(
        `${isOmniRoute() ? 'OmniRoute' : 'OpenRouter'} returned an empty response.`
      );
    }

    traceLog(traceId, 'openrouter.complete', {
      contentChars: content.length,
      elapsedMs: Date.now() - requestStart,
      routed: lastRouted || requested,
    });
    return content;
  } catch (err) {
    traceError(traceId, 'openrouter.read.failed', err, { elapsedMs: Date.now() - requestStart });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** In-app resume agent — MiniMax / OmniRoute / OpenRouter. Returns LaTeX + LLM match report. */
export async function generateResumeWithOpenRouter(
  ctx: ResumeJobContext
): Promise<ResumeGenerationResult> {
  const { openRouter } = config.resumeAgent;
  const traceId = ctx.traceId || makeTraceId('resume-openrouter');
  if (!openRouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set — add it to backend/.env');
  }

  const userPrompt = buildResumeUserPrompt(ctx.jobDescription);
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const gateway = isOmniRoute() ? 'OmniRoute' : 'OpenRouter';
  let usedLabel = formatLlmLabel({ gateway, requested: openRouter.model });

  console.log(
    `\n🤖 Resume agent (${gateway}) — ${openRouter.model} — embedded rules + JD (${userPrompt.length} chars)`
  );
  traceLog(traceId, 'openrouter.generate.start', {
    provider: gateway,
    model: openRouter.model,
    userPromptChars: userPrompt.length,
    systemPromptChars: systemPrompt.length,
  });

  const content = await openRouterChatCompletion(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    {
      traceId,
      signal: ctx.abortSignal,
      work: 'Resume generate',
      onModel: (info) => {
        usedLabel = info.label;
        void ctx.onLlmRoute?.(info.label);
      },
    }
  );

  const parsed = parseModelResumeResponse(content);
  traceLog(traceId, 'openrouter.generate.parsed', {
    latexChars: parsed.latex.length,
    hasLlmMatch: Boolean(parsed.llmMatch),
    usedProvider: usedLabel,
  });
  console.log(
    `Resume agent LaTeX ready (${parsed.latex.length} chars via ${usedLabel})` +
      (parsed.llmMatch
        ? ` · LLM match keyword ${parsed.llmMatch.keywordMatchScore}% / resume ${parsed.llmMatch.resumeMatchScore}%`
        : ' · (no MATCH_REPORT from model)')
  );
  return {
    ...parsed,
    usedProvider: usedLabel,
  };
}
