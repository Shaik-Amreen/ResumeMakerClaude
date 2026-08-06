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

export type { ResumeJobContext };

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

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const waitMs = config.ollama.responseWaitMs;
  console.log(
    `\n🦙 Ollama API — model ${config.ollama.model} — embedded rules + JD only (${userPrompt.length} chars, timeout ${Math.round(waitMs / 60000)}m)`
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
      body: JSON.stringify({
        model: config.ollama.model,
        messages,
        stream: false,
        keep_alive: config.ollama.keepAlive,
      }),
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

  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content || '';
  if (!content.trim()) {
    throw new Error('Ollama returned an empty response.');
  }

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
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        keep_alive: keepAlive,
      }),
    })) as Response;
    if (!res.ok) {
      const text = await res.text();
      console.warn(`Ollama warm-up failed (${model}): ${text.slice(0, 200)}`);
      return;
    }
    console.log(`Ollama model warmed: ${model} (keep_alive=${keepAlive})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Ollama warm-up skipped — is Ollama running? (${msg})`);
  }
}
