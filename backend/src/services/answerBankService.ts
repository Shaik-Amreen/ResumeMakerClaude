import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { applicationProfile, formatDesiredSalaryRange } from '../data/applicationProfile';

export type AnswerBankRow = {
  question: string;
  questionNorm: string;
  answer: string;
  updatedAt: string;
};

const ANSWER_BANK_PATH = path.join(config.uploadsDir, '..', 'data', 'extension-answer-bank.json');

export function normalizeQuestion(q: string): string {
  return String(q || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function readAnswerBank(): AnswerBankRow[] {
  try {
    if (!fs.existsSync(ANSWER_BANK_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(ANSWER_BANK_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeAnswerBank(rows: AnswerBankRow[]) {
  fs.mkdirSync(path.dirname(ANSWER_BANK_PATH), { recursive: true });
  fs.writeFileSync(ANSWER_BANK_PATH, JSON.stringify(rows, null, 2));
}

export function defaultAnswerBank(): AnswerBankRow[] {
  const p = applicationProfile;
  const seed = [
    { question: 'Are you legally authorized to work in the United States?', answer: p.legallyAuthorizedToWorkInUS },
    { question: 'Will you now or in the future require sponsorship?', answer: p.futureRequireSponsorship },
    { question: 'Do you require visa sponsorship?', answer: p.requireVisa },
    { question: 'Do you currently require sponsorship?', answer: p.nowRequireSponsorship },
    { question: 'Years of experience', answer: p.yearsOfExperience },
    { question: 'LinkedIn profile', answer: p.linkedin },
    { question: 'Website / portfolio', answer: p.website },
    { question: 'Desired salary', answer: formatDesiredSalaryRange(p) },
    { question: 'Desired start date', answer: p.desiredStartDate },
    { question: 'Are you willing to relocate?', answer: p.willingToRelocate },
    { question: 'Gender', answer: p.gender },
    { question: 'Veteran status', answer: p.veteranStatus },
    { question: 'Disability status', answer: p.disabilityStatus },
  ];
  return seed.map((s) => ({
    question: s.question,
    questionNorm: normalizeQuestion(s.question),
    answer: String(s.answer ?? ''),
    updatedAt: new Date().toISOString(),
  }));
}

export function mergedAnswerBank(): AnswerBankRow[] {
  const stored = readAnswerBank();
  const defaults = defaultAnswerBank();
  const byNorm = new Map<string, AnswerBankRow>();
  for (const d of defaults) byNorm.set(d.questionNorm, d);
  for (const s of stored) byNorm.set(s.questionNorm, s);
  return [...byNorm.values()];
}

export function upsertAnswer(question: string, answer: string): AnswerBankRow {
  const norm = normalizeQuestion(question);
  const rows = readAnswerBank().filter((r) => r.questionNorm !== norm);
  const row: AnswerBankRow = {
    question: question.slice(0, 300),
    questionNorm: norm,
    answer,
    updatedAt: new Date().toISOString(),
  };
  rows.unshift(row);
  writeAnswerBank(rows.slice(0, 500));
  return row;
}

export function deleteAnswer(questionNorm: string): boolean {
  const before = readAnswerBank();
  const rows = before.filter((r) => r.questionNorm !== questionNorm);
  if (rows.length === before.length) return false;
  writeAnswerBank(rows);
  return true;
}

function tokenizeQuestion(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 1 &&
        !/^(the|and|are|you|for|with|your|this|that|will|have|from|into)$/.test(t)
    );
}

function jaccardTokens(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function lookupAnswer(question: string): {
  matched: boolean;
  score: number;
  mode: 'exact' | 'strong' | 'fuzzy' | 'none';
  question?: string;
  answer?: string;
} {
  const bank = mergedAnswerBank();
  const norm = normalizeQuestion(question);
  const qToks = tokenizeQuestion(norm);
  let best: AnswerBankRow | null = null;
  let bestScore = 0;
  for (const row of bank) {
    if (!row.answer) continue;
    if (norm === row.questionNorm) {
      return { matched: true, score: 1, mode: 'exact', question: row.question, answer: row.answer };
    }
    let score = 0;
    if (norm.includes(row.questionNorm) || row.questionNorm.includes(norm)) {
      score =
        Math.min(norm.length, row.questionNorm.length) /
        Math.max(norm.length, row.questionNorm.length);
    }
    score = Math.max(score, jaccardTokens(qToks, tokenizeQuestion(row.questionNorm)));
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  if (best && bestScore >= 0.48) {
    return {
      matched: true,
      score: Math.round(bestScore * 100) / 100,
      mode: bestScore >= 0.85 ? 'strong' : 'fuzzy',
      question: best.question,
      answer: best.answer,
    };
  }
  return { matched: false, score: 0, mode: 'none' };
}
