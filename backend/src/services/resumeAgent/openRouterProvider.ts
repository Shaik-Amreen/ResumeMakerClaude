import { config } from '../../config';
import {
  buildResumeSystemPrompt,
  buildResumeUserPrompt,
  type ResumeJobContext,
} from '../resumeTailoringPrompt';
import { parseModelResumeResponse, type LlmMatchReport } from './extractLatex';

export type { LlmMatchReport };

export interface ResumeGenerationResult {
  latex: string;
  llmMatch?: LlmMatchReport;
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string; reasoning_content?: string };
  }>;
  error?: { message?: string };
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function isOmniRoute(): boolean {
  return /20128|omniroute/i.test(config.resumeAgent.openRouter.baseUrl);
}

function isTransientStreamError(msg: string): boolean {
  return /\b(terminated|ECONNRESET|ECONNREFUSED|fetch failed|socket hang up|network|timeout|UND_ERR|aborted|temporarily|unreachable)\b/i.test(
    msg
  );
}

function formatFetchError(err: unknown, baseUrl: string): Error {
  const cause =
    err && typeof err === 'object' && 'cause' in err
      ? (err as { cause?: { code?: string; message?: string } }).cause
      : undefined;
  const code = cause?.code || '';
  const detail = cause?.message || (err instanceof Error ? err.message : String(err));
  if (/ECONNREFUSED/i.test(code) || /ECONNREFUSED|fetch failed/i.test(detail)) {
    return new Error(
      `OmniRoute unreachable at ${baseUrl} (${code || 'fetch failed'}). ` +
        `Start OmniRoute on port 20128, then retry Generate resumes.`
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** True when OmniRoute/OpenRouter base URL accepts connections. */
export async function isResumeLlmReachable(): Promise<boolean> {
  const { openRouter } = config.resumeAgent;
  const base = openRouter.baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/models`, {
      headers: openRouter.apiKey ? { Authorization: `Bearer ${openRouter.apiKey}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    return res.ok || res.status === 401 || res.status === 404;
  } catch {
    try {
      // Some proxies have no /models — probe chat endpoint shape with a tiny invalid body.
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouter.apiKey || 'x'}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(4000),
      });
      return res.status !== 0;
    } catch {
      return false;
    }
  }
}

/** Parse OpenAI-compatible SSE (`data: {...}`) into assistant text. */
async function readSseChatContent(res: Response): Promise<string> {
  if (!res.body) throw new Error('OpenRouter/OmniRoute stream had no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let streamError: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
          streamError = chunk.error.message;
          // Keep reading if more chunks arrive; otherwise throw below.
          continue;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') content += delta;
        const full = chunk.choices?.[0]?.message?.content;
        if (typeof full === 'string' && full && !delta) content = full;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Connection drop mid-stream — keep partial content if we already have LaTeX.
    if (content.trim().length > 800 && /\\section|\\documentclass|textbf\{Education\}/i.test(content)) {
      console.warn(
        `OmniRoute/OpenRouter stream dropped (${msg}) — using ${content.length} chars of partial output.`
      );
      return content;
    }
    throw new Error(`OpenRouter stream error: ${msg}`);
  }

  if (streamError) {
    // "terminated" often means upstream killed a long stream; salvage if we got enough.
    if (
      content.trim().length > 800 &&
      /\\section|\\documentclass|textbf\{Education\}/i.test(content) &&
      isTransientStreamError(streamError)
    ) {
      console.warn(
        `OmniRoute stream reported "${streamError}" — using ${content.length} chars of partial output.`
      );
      return content;
    }
    throw new Error(`OpenRouter stream error: ${streamError}`);
  }

  return content;
}

async function chatOnce(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; stream: boolean }
): Promise<string> {
  const { openRouter } = config.resumeAgent;
  let res: Response;
  try {
    res = await fetch(`${openRouter.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouter.apiKey}`,
        'Content-Type': 'application/json',
        Accept: opts.stream ? 'text/event-stream' : 'application/json',
        'HTTP-Referer': openRouter.siteUrl,
        'X-Title': openRouter.appName,
      },
      body: JSON.stringify({
        model: openRouter.model,
        messages,
        max_tokens: opts.maxTokens ?? openRouter.maxTokens,
        temperature: opts.temperature ?? openRouter.temperature,
        stream: opts.stream,
      }),
    });
  } catch (err) {
    throw formatFetchError(err, openRouter.baseUrl);
  }

  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    const text = await res.text();
    let msg = text.slice(0, 400);
    try {
      const errJson = JSON.parse(text) as OpenRouterChatResponse;
      if (errJson.error?.message) msg = errJson.error.message;
    } catch {
      /* keep raw */
    }
    throw new Error(`OpenRouter error (${res.status}): ${msg}`);
  }

  let content = '';
  if (opts.stream || contentType.includes('text/event-stream')) {
    content = await readSseChatContent(res);
  } else {
    const data = (await res.json()) as OpenRouterChatResponse;
    if (data.error?.message) {
      throw new Error(`OpenRouter error: ${data.error.message}`);
    }
    content = data.choices?.[0]?.message?.content || '';
  }

  if (!content.trim()) {
    throw new Error(
      `${isOmniRoute() ? 'OmniRoute' : 'OpenRouter'} returned an empty response.`
    );
  }
  return content;
}

/**
 * Chat completion against OpenRouter or OmniRoute.
 * OmniRoute's non-stream path often 503s / hangs — prefer SSE and assemble text.
 * Retries on transient "terminated" / network drops (common on long revise calls).
 */
export async function openRouterChatCompletion(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const { openRouter } = config.resumeAgent;
  if (!openRouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set — add it to backend/.env');
  }

  const maxAttempts = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const useStream = attempt < maxAttempts; // last try: non-stream JSON
    try {
      if (attempt > 1) {
        console.warn(
          `OmniRoute/OpenRouter retry ${attempt}/${maxAttempts} (${useStream ? 'stream' : 'non-stream'})…`
        );
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
      return await chatOnce(messages, {
        maxTokens: opts?.maxTokens,
        temperature: opts?.temperature,
        stream: useStream,
      });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isTransientStreamError(msg) || attempt === maxAttempts) {
        throw err;
      }
      console.warn(`Transient OmniRoute error (attempt ${attempt}): ${msg}`);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** In-app resume agent — MiniMax / OmniRoute / OpenRouter. Returns LaTeX + LLM match report. */
export async function generateResumeWithOpenRouter(
  ctx: ResumeJobContext
): Promise<ResumeGenerationResult> {
  const { openRouter } = config.resumeAgent;
  if (!openRouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set — add it to backend/.env');
  }

  const userPrompt = buildResumeUserPrompt(ctx.jobDescription);
  const systemPrompt = buildResumeSystemPrompt(ctx);

  console.log(
    `\n🤖 Resume agent (${isOmniRoute() ? 'OmniRoute' : 'OpenRouter'}) — ${openRouter.model} — embedded rules + JD (${userPrompt.length} chars)`
  );

  const content = await openRouterChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const parsed = parseModelResumeResponse(content);
  console.log(
    `Resume agent LaTeX ready (${parsed.latex.length} chars)` +
      (parsed.llmMatch
        ? ` · LLM match keyword ${parsed.llmMatch.keywordMatchScore}% / resume ${parsed.llmMatch.resumeMatchScore}%`
        : ' · (no MATCH_REPORT from model)')
  );
  return parsed;
}
