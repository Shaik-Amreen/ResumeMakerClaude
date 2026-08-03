import { config } from '../../config';
import type { ResumeJobContext } from '../resumeTailoringPrompt';
import {
  buildResumeSystemPrompt,
  buildPasteToLatexSystemPrompt,
  buildPasteToLatexUserPrompt,
  type PasteResumeContext,
} from '../resumeTailoringPrompt';
import { generateResumeWithOllamaApi } from '../ollamaService';
import {
  generateResumeWithOpenRouter,
  openRouterChatCompletion,
  type ResumeGenerationResult,
} from './openRouterProvider';
import {
  generateResumeWithClaudeCode,
  reviseResumeWithClaudeCode,
  runClaudePrint,
} from './claudeCodeProvider';
import { extractLatexFromModelResponse } from './extractLatex';
import { Agent, fetch as undiciFetch } from 'undici';

export type { ResumeJobContext, PasteResumeContext, ResumeGenerationResult };

function shouldFallbackToLocalOllama(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('402') ||
    msg.includes('429') ||
    msg.includes('Insufficient credits') ||
    msg.includes('rate limit') ||
    msg.includes('insufficient_quota')
  );
}

function shouldFallbackFromClaudeCode(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /401|Invalid API key|Failed to authenticate|Claude Code auth failed/i.test(msg);
}

/** Built-in resume agent — Claude Code, OmniRoute/OpenRouter, or local Ollama */
export async function generateResumeLatex(ctx: ResumeJobContext): Promise<ResumeGenerationResult> {
  const provider = config.resumeAgent.provider;

  if (provider === 'claude-code') {
    try {
      return await generateResumeWithClaudeCode(ctx);
    } catch (err) {
      if (shouldFallbackFromClaudeCode(err) && config.resumeAgent.openRouter.apiKey) {
        console.warn('Claude Code auth failed — falling back to OmniRoute/OpenRouter…');
        try {
          return await generateResumeWithOpenRouter(ctx);
        } catch (orErr) {
          if (shouldFallbackToLocalOllama(orErr)) {
            console.warn('OpenRouter/OmniRoute unavailable — falling back to free local Ollama…');
            return generateResumeWithOllamaApi(ctx);
          }
          throw orErr;
        }
      }
      throw err;
    }
  }

  if (provider === 'openrouter') {
    try {
      return await generateResumeWithOpenRouter(ctx);
    } catch (err) {
      if (shouldFallbackToLocalOllama(err)) {
        console.warn('OpenRouter/OmniRoute unavailable — falling back to free local Ollama…');
        return generateResumeWithOllamaApi(ctx);
      }
      throw err;
    }
  }

  if (provider === 'ollama') {
    return generateResumeWithOllamaApi(ctx);
  }

  throw new Error(
    `Unknown RESUME_PROVIDER: ${provider}. Use claude-code, openrouter, or ollama.`
  );
}

async function reviseWithOllama(ctx: ResumeJobContext, latex: string, instruction: string): Promise<string> {
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        'Revise this amazon.pdf-style resume.',
        instruction,
        'OUTPUT RULES: Start at \\section{\\textbf{Education}}. Do NOT output \\documentclass or preamble.',
        'Keep name Amreen Kousar only (locked in header by pipeline). No fontspec. No invented people.',
        'Output ONLY Education → Certifications section LaTeX.',
        '',
        'CURRENT BODY (may include full doc — revise content, keep facts):',
        latex,
      ].join('\n'),
    },
  ];

  const waitMs = config.ollama.responseWaitMs;
  const agent = new Agent({
    headersTimeout: waitMs,
    bodyTimeout: waitMs,
    connectTimeout: 120_000,
  });

  const res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
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

  if (!res.ok) {
    throw new Error(`Ollama revise error: ${(await res.text()).slice(0, 400)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content || '';
  if (!content.trim()) throw new Error('Ollama revise returned empty response.');
  return extractLatexFromModelResponse(content);
}

async function reviseWithOpenRouter(
  ctx: ResumeJobContext,
  latex: string,
  instruction: string
): Promise<string> {
  const { openRouter } = config.resumeAgent;
  if (!openRouter.apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const systemPrompt = buildResumeSystemPrompt(ctx);
  const content = await openRouterChatCompletion(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          'Revise this amazon.pdf-style resume.',
          instruction,
          'OUTPUT RULES: Start at \\section{\\textbf{Education}}. Do NOT output \\documentclass or preamble.',
          'Keep name Amreen Kousar only. No fontspec. No invented people.',
          'Output ONLY Education → Certifications section LaTeX.',
          '',
          'CURRENT BODY:',
          latex,
        ].join('\n'),
      },
    ],
    { temperature: Math.min(0.35, openRouter.temperature) }
  );
  return extractLatexFromModelResponse(content);
}

/** Ask the active resume agent to revise LaTeX for page-count or JD-match fixes. */
export async function reviseResumeLatex(
  ctx: ResumeJobContext,
  latex: string,
  instruction: string
): Promise<string> {
  const provider = config.resumeAgent.provider;
  console.log(`\n🔧 Resume revise (${provider}): ${instruction.slice(0, 120)}…`);

  if (provider === 'claude-code') {
    try {
      return await reviseResumeWithClaudeCode(ctx, latex, instruction);
    } catch (err) {
      if (shouldFallbackFromClaudeCode(err) && config.resumeAgent.openRouter.apiKey) {
        console.warn('Claude Code revise auth failed — falling back to OmniRoute/OpenRouter…');
        try {
          return await reviseWithOpenRouter(ctx, latex, instruction);
        } catch (orErr) {
          if (shouldFallbackToLocalOllama(orErr)) {
            return reviseWithOllama(ctx, latex, instruction);
          }
          throw orErr;
        }
      }
      throw err;
    }
  }

  if (provider === 'openrouter') {
    try {
      return await reviseWithOpenRouter(ctx, latex, instruction);
    } catch (err) {
      if (shouldFallbackToLocalOllama(err)) {
        console.warn('OpenRouter revise unavailable — falling back to Ollama…');
        return reviseWithOllama(ctx, latex, instruction);
      }
      throw err;
    }
  }

  if (provider === 'ollama') {
    return reviseWithOllama(ctx, latex, instruction);
  }

  throw new Error(`Unknown RESUME_PROVIDER: ${provider}`);
}

export function resumeAgentLabel(): string {
  const { provider, openRouter, claudeCode } = config.resumeAgent;
  if (provider === 'claude-code') {
    return `Claude Code (${claudeCode.model})`;
  }
  if (provider === 'openrouter') {
    const viaOmni = /20128|omniroute/i.test(openRouter.baseUrl);
    if (viaOmni) {
      return `OmniRoute (${openRouter.model}) @ ${openRouter.baseUrl}`;
    }
    return `OpenRouter (${openRouter.model}) → local Ollama fallback`;
  }
  return `Local Ollama (${config.ollama.model})`;
}

async function chatWithOllamaRaw(systemPrompt: string, userPrompt: string): Promise<string> {
  const waitMs = config.ollama.responseWaitMs;
  const agent = new Agent({
    headersTimeout: waitMs,
    bodyTimeout: waitMs,
    connectTimeout: 120_000,
  });
  const res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      keep_alive: config.ollama.keepAlive,
    }),
    dispatcher: agent,
  })) as Response;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama API error: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content || '';
  if (!content.trim()) throw new Error('Ollama returned an empty response.');
  return extractLatexFromModelResponse(content);
}

async function chatWithOpenRouterRaw(systemPrompt: string, userPrompt: string): Promise<string> {
  const content = await openRouterChatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  return extractLatexFromModelResponse(content);
}

/** Paste any portal resume (+ optional JD) → amazon.pdf LaTeX via active provider. */
export async function generateLatexFromPaste(ctx: PasteResumeContext): Promise<string> {
  const systemPrompt = buildPasteToLatexSystemPrompt(ctx);
  const userPrompt = buildPasteToLatexUserPrompt(ctx);
  const provider = config.resumeAgent.provider;

  console.log(
    `\n📋 Paste→LaTeX via ${provider} (${ctx.resumeText.length} char resume${ctx.jobDescription ? ' + JD' : ''})`
  );

  if (provider === 'claude-code') {
    const content = await runClaudePrint(systemPrompt, userPrompt);
    return extractLatexFromModelResponse(content);
  }

  if (provider === 'openrouter') {
    try {
      return await chatWithOpenRouterRaw(systemPrompt, userPrompt);
    } catch (err) {
      if (shouldFallbackToLocalOllama(err)) {
        console.warn('OpenRouter/OmniRoute unavailable — falling back to Ollama…');
        return chatWithOllamaRaw(systemPrompt, userPrompt);
      }
      throw err;
    }
  }

  if (provider === 'ollama') {
    return chatWithOllamaRaw(systemPrompt, userPrompt);
  }

  throw new Error(`Unknown RESUME_PROVIDER: ${provider}`);
}
