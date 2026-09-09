import { Agent, fetch as undiciFetch } from 'undici';
import { config } from '../config';
import {
  appendOllamaChatMessages,
  resolveOllamaResumeChatId,
} from './ollamaChatStore';
import {
  buildResumeSystemPrompt,
  buildResumeUserPrompt,
  type ResumeJobContext,
} from './resumeTailoringPrompt';
import { extractLatexFromModelResponse, parseModelResumeResponse } from './resumeAgent/extractLatex';
import type { ResumeGenerationResult } from './resumeAgent/openRouterProvider';
import { logLlmInUse } from './resumeAgent/llmRoute';

export type { ResumeJobContext };

export type OllamaChatMessage = { role: string; content: string };

/**
 * qwen3.x (and similar) thinking models put tokens in `message.thinking` and often leave
 * `message.content` empty unless thinking is disabled. Always set think:false for structured output.
 */
export function buildOllamaChatRequest(
  messages: OllamaChatMessage[],
  opts?: { numPredict?: number; temperature?: number }
): Record<string, unknown> {
  const options: Record<string, unknown> = {
    num_predict: opts?.numPredict ?? 16384,
  };
  if (opts?.temperature != null) options.temperature = opts.temperature;
  return {
    model: config.ollama.model,
    messages,
    stream: false,
    keep_alive: config.ollama.keepAlive,
    think: false,
    options,
  };
}

export function readOllamaChatContent(data: {
  message?: { content?: string; thinking?: string };
  done_reason?: string;
}): string {
  const content = (data.message?.content || '').trim();
  if (content) return content;
  const thinkingLen = (data.message?.thinking || '').trim().length;
  if (thinkingLen > 0) {
    throw new Error(
      `Ollama returned empty content (spent ${thinkingLen} chars on thinking; done_reason=${data.done_reason || 'unknown'}). ` +
        'Thinking models need think:false for resume generation.'
    );
  }
  throw new Error('Ollama returned an empty response.');
}

/** Scraped JD only — rules/template/profile live in the system prompt. */
export function buildOllamaResumePrompt(jobDescription: string): string {
  return buildResumeUserPrompt(jobDescription);
}

/** @deprecated Use extractLatexFromModelResponse */
export const extractLatexFromOllamaResponse = extractLatexFromModelResponse;

/** Ollama API — embedded instructions + Amazon template + base resume; user message = JD only. */
export async function generateResumeWithOllamaApi(
  ctx: ResumeJobContext
): Promise<ResumeGenerationResult> {
  const userPrompt = buildResumeUserPrompt(ctx.jobDescription);
  const systemPrompt = buildResumeSystemPrompt(ctx);

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const waitMs = config.ollama.responseWaitMs;
  const label = `Ollama (${config.ollama.model})`;
  logLlmInUse('Resume generate', label);
  void ctx.onLlmRoute?.(label);
  console.log(
    `\n🦙 Ollama API — model ${config.ollama.model} — embedded rules + JD only (${userPrompt.length} chars, timeout ${Math.round(waitMs / 60000)}m, think=false)`
  );

  const agent = new Agent({
    headersTimeout: waitMs,
    bodyTimeout: waitMs,
    connectTimeout: 120_000,
  });

  let res: Response;
  try {
    res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOllamaChatRequest(messages)),
      dispatcher: agent,
    })) as Response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ollama timed out or unreachable (${msg}). Keep Ollama app running; local qwen3.6 can take 5–15 min per resume.`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama API error: ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string; thinking?: string };
    done_reason?: string;
  };
  const content = readOllamaChatContent(data);

  return {
    ...parseModelResumeResponse(content),
    usedProvider: `Ollama (${config.ollama.model})`,
  };
}

export async function generateResumeWithOllama(
  ctx: ResumeJobContext
): Promise<{ latex: string; driver: null; llmMatch?: ResumeGenerationResult['llmMatch'] }> {
  const result = await generateResumeWithOllamaApi(ctx);

  try {
    const chatId = resolveOllamaResumeChatId();
    appendOllamaChatMessages(chatId, ctx.jobDescription.trim(), result.latex.slice(0, 12000));
    console.log(`Saved JD + response to Ollama "${config.ollama.chatName}" chat.`);
  } catch (err) {
    console.warn('Could not sync to Ollama desktop chat DB:', err);
  }

  console.log(`Ollama LaTeX ready (${result.latex.length} chars)`);
  return { latex: result.latex, driver: null, llmMatch: result.llmMatch };
}

/** Load the resume model into memory and pin it for `OLLAMA_KEEP_ALIVE` (default 30m). */
export async function warmOllamaModel(): Promise<void> {
  const model = config.ollama.model;
  const keepAlive = config.ollama.keepAlive;
  try {
    const res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildOllamaChatRequest([{ role: 'user', content: 'ping' }], { numPredict: 8 })
      ),
    })) as Response;
    if (!res.ok) {
      const text = await res.text();
      console.warn(`Ollama warm-up failed (${model}): ${text.slice(0, 200)}`);
      return;
    }
    console.log(`Ollama model warmed: ${model} (keep_alive=${keepAlive}, think=false)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Ollama warm-up skipped — is Ollama running? (${msg})`);
  }
}
