import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../config';
import { PipelineAbortError, throwIfAborted } from '../pipelineAbort';
import {
  buildResumeSystemPrompt,
  buildResumeUserPrompt,
  type ResumeJobContext,
} from '../resumeTailoringPrompt';
import { extractLatexFromModelResponse, parseModelResumeResponse } from './extractLatex';
import type { ResumeGenerationResult } from './openRouterProvider';
import { makeTraceId, traceError, traceLog } from '../debugTrace';
import { logLlmInUse } from './llmRoute';

function findClaudeBinary(): string {
  const configured = config.resumeAgent.claudeCode.binary?.trim();
  if (configured && fs.existsSync(configured)) return configured;
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    'claude',
  ];
  for (const c of candidates) {
    if (c === 'claude') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'claude';
}

export async function runClaudePrint(
  systemPrompt: string,
  userPrompt: string,
  traceId = makeTraceId('claude'),
  options?: { signal?: AbortSignal }
): Promise<string> {
  throwIfAborted(options?.signal);
  const { model, timeoutMs } = config.resumeAgent.claudeCode;
  const bin = findClaudeBinary();

  const combinedUser = [
    '=== SYSTEM RULES (obey fully) ===',
    systemPrompt,
    '',
    '=== TASK ===',
    userPrompt,
  ].join('\n');

  const tmpFile = path.join(os.tmpdir(), `claude_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpFile, combinedUser, 'utf8');

  const cmd = `"${bin}" -p "$(cat "${tmpFile}")" --bare --output-format text --permission-mode dontAsk --model ${model} --no-session-persistence < /dev/null`;

  const callStart = Date.now();
  console.log(
    `\n🟣 Resume agent (Claude Code) — model ${model} — (${userPrompt.length} char task, ${systemPrompt.length} char system)`
  );
  traceLog(traceId, 'claude.exec.start', {
    model,
    bin,
    userPromptChars: userPrompt.length,
    systemPromptChars: systemPrompt.length,
    timeoutMs,
  });

  return new Promise<string>((resolve, reject) => {
    const child = exec(cmd, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        CLAUDE_CODE_SIMPLE: '1',
      },
    }, (err, stdout, stderr) => {
      signal?.removeEventListener('abort', onAbort);
      try { fs.unlinkSync(tmpFile); } catch {}
      const elapsedSec = ((Date.now() - callStart) / 1000).toFixed(1);
      const content = String(stdout || '').trim();
      console.log(`  ⏱️ Claude Code CLI returned in ${elapsedSec}s (${content.length} chars output)`);
      traceLog(traceId, 'claude.exec.returned', {
        elapsedSec,
        outputChars: content.length,
        stderrChars: String(stderr || '').length,
        hadError: Boolean(err),
      });

      if (signal?.aborted) {
        return reject(new PipelineAbortError(String(signal.reason || 'Claude Code generation aborted')));
      }

      if (err) {
        traceError(traceId, 'claude.exec.error', err, { stderr: String(stderr || '').slice(0, 300) });
        return reject(new Error(`Claude Code CLI error: ${err.message}${stderr ? ` | ${stderr.slice(0, 300)}` : ''}`));
      }
      if (/401|Invalid API key|Failed to authenticate/i.test(content)) {
        return reject(new Error(`Claude Code auth failed (401 Invalid API key).`));
      }
      if (!content) {
        return reject(new Error(`Claude Code returned empty output.${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ''}`));
      }
      resolve(content);
    });

    const signal = options?.signal;
    const onAbort = () => {
      child.kill('SIGTERM');
      reject(new PipelineAbortError(String(signal?.reason || 'Claude Code generation aborted')));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Generate tailored resume LaTeX via local Claude Code CLI (subscription). */
export async function generateResumeWithClaudeCode(
  ctx: ResumeJobContext
): Promise<ResumeGenerationResult> {
  const traceId = ctx.traceId || makeTraceId('claude-generate');
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const userPrompt = buildResumeUserPrompt(ctx.jobDescription);

  const attempt = async (prompt: string) => {
    const content = await runClaudePrint(systemPrompt, prompt, traceId, { signal: ctx.abortSignal });
    return parseModelResumeResponse(content);
  };

  const label = `Claude Code (${config.resumeAgent.claudeCode.model})`;
  logLlmInUse('Resume generate', label);
  void ctx.onLlmRoute?.(label);

  let parsed: ResumeGenerationResult;
  try {
    parsed = await attempt(userPrompt);
  } catch (err) {
    if (err instanceof PipelineAbortError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (!/No LaTeX found|empty output/i.test(msg)) throw err;
    console.warn(`Claude Code first reply unusable (${msg.slice(0, 160)}) — retrying once…`);
    const retryPrompt = [
      userPrompt,
      '',
      'CRITICAL RETRY: Your previous reply had no usable LaTeX.',
      'Output ONLY the resume body starting at \\section{\\textbf{Work Experience}} through Certifications.',
      'No preamble, no commentary, no markdown fences required. Include \\section and \\item commands.',
    ].join('\n');
    parsed = await attempt(retryPrompt);
  }

  console.log(
    `Claude Code LaTeX ready (${parsed.latex.length} chars)` +
      (parsed.llmMatch
        ? ` · LLM match keyword ${parsed.llmMatch.keywordMatchScore}% / resume ${parsed.llmMatch.resumeMatchScore}%`
        : '')
  );
  return {
    ...parsed,
    usedProvider: `Claude Code (${config.resumeAgent.claudeCode.model})`,
  };
}

export async function reviseResumeWithClaudeCode(
  ctx: ResumeJobContext,
  latex: string,
  instruction: string
): Promise<string> {
  const traceId = ctx.traceId || makeTraceId('claude-revise');
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const userPrompt = [
    'Revise this amazon.pdf-style resume.',
    instruction,
    'OUTPUT RULES: Start at \\section{\\textbf{Work Experience}}. Do NOT output \\documentclass or preamble.',
    'Keep name Karthik Kovi only. No fontspec. No invented people.',
    'Output FULL body: Work Experience → Skills → Key Projects → Education → Certifications.',
    'EXACTLY 1 page. Match amazonResumeTemplate.tex bold/gaps. Amazon → ASI → Infobell only.',
    '',
    'CURRENT BODY:',
    latex,
  ].join('\n');

  traceLog(traceId, 'claude.revise.start', {
    latexChars: latex.length,
    instructionChars: instruction.length,
  });
  const content = await runClaudePrint(systemPrompt, userPrompt, traceId, { signal: ctx.abortSignal });
  const revised = extractLatexFromModelResponse(content);
  traceLog(traceId, 'claude.revise.done', { latexChars: revised.length });
  return revised;
}
