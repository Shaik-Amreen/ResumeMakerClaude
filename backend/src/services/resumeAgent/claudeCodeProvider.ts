import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { config } from '../../config';
import {
  buildResumeSystemPrompt,
  buildResumeUserPrompt,
  type ResumeJobContext,
} from '../resumeTailoringPrompt';
import { extractLatexFromModelResponse, parseModelResumeResponse } from './extractLatex';
import type { ResumeGenerationResult } from './openRouterProvider';

const execFileAsync = promisify(execFile);

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

export async function runClaudePrint(systemPrompt: string, userPrompt: string): Promise<string> {
  const { model, timeoutMs } = config.resumeAgent.claudeCode;
  const bin = findClaudeBinary();

  // Prefer --system-prompt; fall back to a single user message if argv would be huge.
  const combinedUser = [
    '=== SYSTEM RULES (obey fully) ===',
    systemPrompt,
    '',
    '=== TASK ===',
    userPrompt,
  ].join('\n');

  const useInlineSystem = systemPrompt.length < 100_000;

  // Do NOT use --bare: that mode ignores OAuth/keychain and only accepts ANTHROPIC_API_KEY.
  // Skip user settings so ~/.claude OmniRoute (localhost:20128) overrides don't hijack auth.
  const sharedArgs = [
    '--output-format',
    'text',
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--model',
    model,
    '--no-session-persistence',
    '--setting-sources',
    'project',
  ];

  const args = useInlineSystem
    ? ['-p', userPrompt, '--system-prompt', systemPrompt, ...sharedArgs]
    : ['-p', combinedUser, ...sharedArgs];

  console.log(
    `\n🟣 Resume agent (Claude Code) — model ${model} — ${bin} -p (${userPrompt.length} char task)`
  );

  try {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SIMPLE: '1' };
    // Clear OmniRoute / stale key overrides from the parent shell if present.
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;
    delete childEnv.ANTHROPIC_BASE_URL;
    delete childEnv.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete childEnv.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete childEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL;

    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: childEnv,
    });

    const content = (stdout || '').trim();
    if (/401|Invalid API key|Failed to authenticate/i.test(content)) {
      throw new Error(
        `Claude Code auth failed (401 Invalid API key). ` +
          `Run \`claude login\` or clear the bad ANTHROPIC_API_KEY, or set RESUME_PROVIDER=openrouter for OmniRoute.`
      );
    }
    if (!content) {
      throw new Error(
        `Claude Code returned empty output.${stderr ? ` stderr: ${stderr.slice(0, 400)}` : ''}`
      );
    }
    return content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found/i.test(msg)) {
      throw new Error(
        'Claude Code CLI not found. Install Claude Code, or set CLAUDE_CODE_BINARY in backend/.env'
      );
    }
    // execFile often embeds stdout in the message — lift the auth hint up.
    if (/401|Invalid API key|Failed to authenticate/i.test(msg)) {
      throw new Error(
        `Claude Code auth failed (401 Invalid API key). ` +
          `Run \`claude login\` or clear the bad ANTHROPIC_API_KEY, or set RESUME_PROVIDER=openrouter for OmniRoute.`
      );
    }
    throw err;
  }
}

/** Generate tailored resume LaTeX via local Claude Code CLI (subscription). */
export async function generateResumeWithClaudeCode(
  ctx: ResumeJobContext
): Promise<ResumeGenerationResult> {
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const userPrompt = buildResumeUserPrompt(ctx.jobDescription);
  const content = await runClaudePrint(systemPrompt, userPrompt);
  const parsed = parseModelResumeResponse(content);
  console.log(
    `Claude Code LaTeX ready (${parsed.latex.length} chars)` +
      (parsed.llmMatch
        ? ` · LLM match keyword ${parsed.llmMatch.keywordMatchScore}% / resume ${parsed.llmMatch.resumeMatchScore}%`
        : '')
  );
  return parsed;
}

export async function reviseResumeWithClaudeCode(
  ctx: ResumeJobContext,
  latex: string,
  instruction: string
): Promise<string> {
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const userPrompt = [
    'Revise this amazon.pdf-style resume.',
    instruction,
    'OUTPUT RULES: Start at \\section{\\textbf{Education}}. Do NOT output \\documentclass or preamble.',
    'Keep name Amreen Kousar only. No fontspec. No invented people.',
    'Output ONLY Education → Certifications section LaTeX.',
    '',
    'CURRENT BODY:',
    latex,
  ].join('\n');

  const content = await runClaudePrint(systemPrompt, userPrompt);
  return extractLatexFromModelResponse(content);
}
