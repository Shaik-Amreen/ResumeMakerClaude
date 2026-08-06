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

import { exec } from 'child_process';

export async function runClaudePrint(systemPrompt: string, userPrompt: string): Promise<string> {
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

  return new Promise<string>((resolve, reject) => {
    exec(cmd, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        CLAUDE_CODE_SIMPLE: '1',
      },
    }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      const elapsedSec = ((Date.now() - callStart) / 1000).toFixed(1);
      const content = String(stdout || '').trim();
      console.log(`  ⏱️ Claude Code CLI returned in ${elapsedSec}s (${content.length} chars output)`);

      if (err) {
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
  });
}

/** Generate tailored resume LaTeX via local Claude Code CLI (subscription). */
export async function generateResumeWithClaudeCode(
  ctx: ResumeJobContext
): Promise<ResumeGenerationResult> {
  const systemPrompt = buildResumeSystemPrompt(ctx);
  const userPrompt = buildResumeUserPrompt(ctx.jobDescription);

  const attempt = async (prompt: string) => {
    const content = await runClaudePrint(systemPrompt, prompt);
    return parseModelResumeResponse(content);
  };

  let parsed: ResumeGenerationResult;
  try {
    parsed = await attempt(userPrompt);
  } catch (err) {
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
    'OUTPUT RULES: Start at \\section{\\textbf{Work Experience}}. Do NOT output \\documentclass or preamble.',
    'Keep name Karthik Kovi only. No fontspec. No invented people.',
    'Output FULL body: Work Experience → Skills → Key Projects → Education → Certifications.',
    'EXACTLY 1 page. Match amazonResumeTemplate.tex bold/gaps. Amazon → ASI → Infobell only.',
    '',
    'CURRENT BODY:',
    latex,
  ].join('\n');

  const content = await runClaudePrint(systemPrompt, userPrompt);
  return extractLatexFromModelResponse(content);
}
