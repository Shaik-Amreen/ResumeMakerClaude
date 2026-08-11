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
import { makeTraceId, traceError, traceLog } from '../debugTrace';
import { isPipelineAbortError } from '../pipelineAbort';

export type { ResumeJobContext, PasteResumeContext, ResumeGenerationResult };

function shouldFallbackToLocalOllama(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('402') ||
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('Insufficient credits') ||
    msg.includes('rate limit') ||
    msg.includes('insufficient_quota') ||
    /temporarily unavailable|all upstream accounts are inactive|ALL_ACCOUNTS_INACTIVE|service_unavailable/i.test(
      msg
    )
  );
}

/** Helper to format error message string */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Built-in resume agent — Claude Code, OmniRoute/OpenRouter, or local Ollama with resilient multi-tier fallback */
export async function generateResumeLatex(ctx: ResumeJobContext): Promise<ResumeGenerationResult> {
  const provider = config.resumeAgent.provider;
  const traceId = ctx.traceId || makeTraceId('resume-agent');
  traceLog(traceId, 'agent.generate.dispatch', { provider });

  if (provider === 'claude-code') {
    try {
      traceLog(traceId, 'agent.claude-code.start');
      return await generateResumeWithClaudeCode(ctx);
    } catch (err) {
      if (isPipelineAbortError(err)) throw err;
      console.warn(`⚠️ Claude Code generation failed (${errMessage(err).slice(0, 150)}) — falling back to OmniRoute/OpenRouter…`);
      traceError(traceId, 'agent.claude-code.failed', err);
      try {
        traceLog(traceId, 'agent.openrouter.fallback.start');
        return await generateResumeWithOpenRouter(ctx);
      } catch (orErr) {
        console.warn(`⚠️ OpenRouter/OmniRoute generation failed (${errMessage(orErr).slice(0, 150)}) — falling back to free local Ollama…`);
        traceError(traceId, 'agent.openrouter.fallback.failed', orErr);
        traceLog(traceId, 'agent.ollama.fallback.start');
        return await generateResumeWithOllamaApi(ctx);
      }
    }
  }

  if (provider === 'openrouter') {
    try {
      traceLog(traceId, 'agent.openrouter.start');
      return await generateResumeWithOpenRouter(ctx);
    } catch (err) {
      console.warn(`⚠️ OpenRouter/OmniRoute generation failed (${errMessage(err).slice(0, 150)}) — falling back to free local Ollama…`);
      traceError(traceId, 'agent.openrouter.failed', err);
      traceLog(traceId, 'agent.ollama.fallback.start');
      return await generateResumeWithOllamaApi(ctx);
    }
  }

  if (provider === 'ollama') {
    traceLog(traceId, 'agent.ollama.start');
    return await generateResumeWithOllamaApi(ctx);
  }

  throw new Error(
    `Unknown RESUME_PROVIDER: ${provider}. Use claude-code, openrouter, or ollama.`
  );
}

async function reviseWithOllama(ctx: ResumeJobContext, latex: string, instruction: string): Promise<string> {
  const traceId = ctx.traceId || makeTraceId('ollama-revise');
  traceLog(traceId, 'ollama.revise.start', { latexChars: latex.length, instructionChars: instruction.length });
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        'Revise this amazon.pdf-style resume.',
        instruction,
        'OUTPUT RULES: Start at \\section{\\textbf{Work Experience}}. Do NOT output \\documentclass or preamble.',
        'Keep name Karthik Kovi only (locked in header by pipeline). No fontspec. No invented people.',
        'Output FULL body: Work Experience → Skills → Key Projects → Education → Certifications.',
        'EXACTLY 1 page. Match amazonResumeTemplate.tex. Amazon → ASI → Infobell only.',
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
  const revised = extractLatexFromModelResponse(content);
  traceLog(traceId, 'ollama.revise.done', { latexChars: revised.length });
  return revised;
}

async function reviseWithOpenRouter(
  ctx: ResumeJobContext,
  latex: string,
  instruction: string
): Promise<string> {
  const { openRouter } = config.resumeAgent;
  const traceId = ctx.traceId || makeTraceId('openrouter-revise');
  if (!openRouter.apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  traceLog(traceId, 'openrouter.revise.start', { latexChars: latex.length, instructionChars: instruction.length });
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const content = await openRouterChatCompletion(
    [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          'Revise this amazon.pdf-style resume.',
          instruction,
          'OUTPUT RULES: Start at \\section{\\textbf{Work Experience}}. Do NOT output \\documentclass or preamble.',
          'Keep name Karthik Kovi only. No fontspec. No invented people.',
          'Output FULL body: Work Experience → Skills → Key Projects → Education → Certifications.',
          'EXACTLY 1 page. Match amazonResumeTemplate.tex. Amazon → ASI → Infobell only.',
          '',
          'CURRENT BODY:',
          latex,
        ].join('\n'),
      },
    ],
    { temperature: Math.min(0.35, openRouter.temperature), traceId, signal: ctx.abortSignal }
  );
  const revised = extractLatexFromModelResponse(content);
  traceLog(traceId, 'openrouter.revise.done', { latexChars: revised.length });
  return revised;
}

/** Ask the active resume agent to revise LaTeX for page-count or JD-match fixes. */
export async function reviseResumeLatex(
  ctx: ResumeJobContext,
  latex: string,
  instruction: string
): Promise<string> {
  const provider = config.resumeAgent.provider;
  const traceId = ctx.traceId || makeTraceId('resume-revise');
  console.log(`\n🔧 Resume revise (${provider}): ${instruction.slice(0, 120)}…`);
  traceLog(traceId, 'agent.revise.dispatch', {
    provider,
    latexChars: latex.length,
    instruction: instruction.slice(0, 180),
  });

  if (provider === 'claude-code') {
    try {
      traceLog(traceId, 'agent.revise.claude-code.start');
      return await reviseResumeWithClaudeCode(ctx, latex, instruction);
    } catch (err) {
      if (isPipelineAbortError(err)) throw err;
      console.warn(`⚠️ Claude Code revise failed (${errMessage(err).slice(0, 150)}) — falling back to OmniRoute/OpenRouter…`);
      traceError(traceId, 'agent.revise.claude-code.failed', err);
      try {
        traceLog(traceId, 'agent.revise.openrouter.fallback.start');
        return await reviseWithOpenRouter(ctx, latex, instruction);
      } catch (orErr) {
        console.warn(`⚠️ OpenRouter revise failed (${errMessage(orErr).slice(0, 150)}) — falling back to local Ollama…`);
        traceError(traceId, 'agent.revise.openrouter.fallback.failed', orErr);
        traceLog(traceId, 'agent.revise.ollama.fallback.start');
        return await reviseWithOllama(ctx, latex, instruction);
      }
    }
  }

  if (provider === 'openrouter') {
    try {
      traceLog(traceId, 'agent.revise.openrouter.start');
      return await reviseWithOpenRouter(ctx, latex, instruction);
    } catch (err) {
      console.warn(`⚠️ OpenRouter revise failed (${errMessage(err).slice(0, 150)}) — falling back to local Ollama…`);
      traceError(traceId, 'agent.revise.openrouter.failed', err);
      traceLog(traceId, 'agent.revise.ollama.fallback.start');
      return await reviseWithOllama(ctx, latex, instruction);
    }
  }

  if (provider === 'ollama') {
    traceLog(traceId, 'agent.revise.ollama.start');
    return await reviseWithOllama(ctx, latex, instruction);
  }

  throw new Error(`Unknown RESUME_PROVIDER: ${provider}`);
}

export function resumeAgentLabel(): string {
  const { provider, openRouter, claudeCode } = config.resumeAgent;
  if (provider === 'claude-code') {
    return `Claude Code (${claudeCode.model}) → OpenRouter → Ollama`;
  }
  if (provider === 'openrouter') {
    const viaOmni = /20128|omniroute/i.test(openRouter.baseUrl);
    if (viaOmni) {
      return `OmniRoute (${openRouter.model}) → Ollama`;
    }
    return `OpenRouter (${openRouter.model}) → Ollama`;
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
