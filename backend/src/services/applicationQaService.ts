/**
 * AI answers for custom application questions (Ashby, Greenhouse, etc.).
 * Reuses the global answer bank for exact repeats; generates with JD context otherwise.
 */
import Job from '../models/Job';
import { config } from '../config';
import { cleanJobDescriptionForResume } from './cleanJobDescription';
import { lookupAnswer, upsertAnswer } from './answerBankService';
import { formatResumeProfileForPrompt } from '../data/resumeProfile';
import { openRouterChatCompletion } from './resumeAgent/openRouterProvider';
import { Agent, fetch as undiciFetch } from 'undici';

const CANDIDATE = {
  name: 'Karthik Kovi',
  school: 'California State University, Long Beach',
  degree: 'MS Computer Science (graduating January 2027)',
};

async function callTextLlm(system: string, user: string, timeoutMs = 20_000): Promise<string> {
  if (config.resumeAgent.provider === 'openrouter') {
    try {
      return await openRouterChatCompletion([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
    } catch {
      /* fallback to local Ollama */
    }
  }

  const agent = new Agent({
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connectTimeout: 5_000,
  });

  const res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      keep_alive: config.ollama.keepAlive,
    }),
    dispatcher: agent,
  })) as Response;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return (data.message?.content || '').trim();
}

function inferWordLimit(question: string, explicit?: number): number {
  if (explicit && explicit > 0) return Math.min(explicit, 400);
  const q = question.toLowerCase();
  if (/in\s+\d+\s+words|word limit|max\s+\d+\s+words/.test(q)) {
    const m = q.match(/(\d+)\s*words?/);
    if (m) return Math.min(Number(m[1]), 400);
  }
  if (/brief|short|one sentence|2-3 sentence|few sentence/.test(q)) return 80;
  if (/excited|why|tell us|describe|what makes|proud|challenge|motivat/.test(q)) return 150;
  return 120;
}

function stripAnswerWrappers(raw: string): string {
  let text = String(raw || '').trim();
  text = text.replace(/^```[\w]*\n?/i, '').replace(/\n?```$/i, '');
  text = text.replace(/^(answer|response):\s*/i, '');
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text.trim();
}

export type ApplicationAnswerResult = {
  answer: string;
  source: 'bank' | 'ai';
  bankScore?: number;
  jobId?: string;
  company?: string;
  title?: string;
  wordLimit: number;
};

export async function generateApplicationAnswer(opts: {
  question: string;
  job?: {
    _id?: unknown;
    title?: string;
    company?: string;
    jobDescription?: string;
  } | null;
  wordLimit?: number;
  skipBank?: boolean;
}): Promise<ApplicationAnswerResult> {
  const question = String(opts.question || '').trim().slice(0, 500);
  if (!question) throw new Error('question is required');

  const wordLimit = inferWordLimit(question, opts.wordLimit);
  const job = opts.job;
  const jobId = job?._id ? String(job._id) : undefined;
  const company = String(job?.company || '').trim();
  const title = String(job?.title || '').trim();

  if (!opts.skipBank) {
    const hit = lookupAnswer(question);
    if (hit.matched && hit.answer && (hit.mode === 'exact' || hit.mode === 'strong')) {
      return {
        answer: hit.answer,
        source: 'bank',
        bankScore: hit.score,
        jobId,
        company: company || undefined,
        title: title || undefined,
        wordLimit,
      };
    }
  }

  const jd = cleanJobDescriptionForResume(String(job?.jobDescription || '')).slice(0, 3500);
  const profile = formatResumeProfileForPrompt().slice(0, 4000);

  const system = `You write short, authentic job application answers for ${CANDIDATE.name}.
Rules:
- Use ONLY real employers, projects, and skills from the candidate profile below.
- Never invent metrics, titles, employers, or credentials.
- Sound human and specific — not generic LinkedIn fluff.
- Match the question type: 2-4 sentences for "why/excited" prompts unless a word limit is given.
- Do NOT include markdown, quotes around the whole answer, or a subject line.
- Maximum ${wordLimit} words.`;

  const user = [
    company ? `Company: ${company}` : '',
    title ? `Role: ${title}` : '',
    '',
    `Application question:\n${question}`,
    '',
    jd ? `Job description excerpt:\n${jd}` : '(No job description — answer from profile only.)',
    '',
    `Candidate profile:\n${profile}`,
    '',
    `Write the answer only (${wordLimit} words max).`,
  ]
    .filter(Boolean)
    .join('\n');

  let answer = stripAnswerWrappers(await callTextLlm(system, user));
  if (!answer) {
    answer = `I am excited about ${company || 'this opportunity'} because the role aligns with my background in full-stack and cloud engineering. As an M.S. Computer Science student at CSULB with experience at Amazon and production web/mobile work, I am looking for a team where I can ship reliable software and keep learning. I would welcome the chance to contribute here.`;
  }

  return {
    answer: answer.slice(0, 4000),
    source: 'ai',
    jobId,
    company: company || undefined,
    title: title || undefined,
    wordLimit,
  };
}

/** Persist a reviewed answer to the global bank (extension "Save" action). */
export function saveApplicationAnswerToBank(question: string, answer: string) {
  return upsertAnswer(question, answer.slice(0, 4000));
}

export async function loadJobForApplicationQa(jobId?: string): Promise<InstanceType<typeof Job> | null> {
  if (!jobId) return null;
  return Job.findById(jobId).select({ title: 1, company: 1, jobDescription: 1 }).exec();
}
