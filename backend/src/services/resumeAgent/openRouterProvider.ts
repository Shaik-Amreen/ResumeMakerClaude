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

/** Parse OpenAI-compatible SSE (`data: {...}`) into assistant text. */
async function readSseChatContent(res: Response): Promise<string> {
  if (!res.body) throw new Error('OpenRouter/OmniRoute stream had no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

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
        throw new Error(`OpenRouter stream error: ${chunk.error.message}`);
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') content += delta;
      const full = chunk.choices?.[0]?.message?.content;
      if (typeof full === 'string' && full && !delta) content = full;
    }
  }

  return content;
}

/**
 * Chat completion against OpenRouter or OmniRoute.
 * OmniRoute's non-stream path often 503s / hangs — prefer SSE and assemble text.
 */
export async function openRouterChatCompletion(
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const { openRouter } = config.resumeAgent;
  if (!openRouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set — add it to backend/.env');
  }

  const useStream = true;

  const res = await fetch(`${openRouter.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openRouter.apiKey}`,
      'Content-Type': 'application/json',
      Accept: useStream ? 'text/event-stream' : 'application/json',
      'HTTP-Referer': openRouter.siteUrl,
      'X-Title': openRouter.appName,
    },
    body: JSON.stringify({
      model: openRouter.model,
      messages,
      max_tokens: opts?.maxTokens ?? openRouter.maxTokens,
      temperature: opts?.temperature ?? openRouter.temperature,
      stream: useStream,
    }),
  });

  const contentType = res.headers.get('content-type') || '';

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
    throw new Error(`OpenRouter error (${res.status}): ${msg}${hint}`);
  }

  let content = '';
  if (useStream || contentType.includes('text/event-stream')) {
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
