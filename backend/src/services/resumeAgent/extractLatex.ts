import { enforceAmazonLatex } from './amazonLatexGuard';
import { enforceMasterRules } from './enforceMasterRules';

export interface LlmMatchReport {
  /** All important JD skills the model identified */
  jdSkills: string[];
  matched: string[];
  missing: string[];
  /** Short notes on what’s weak / not evidenced (skill gaps) */
  skillGaps: string[];
  keywordMatchScore: number;
  resumeMatchScore: number;
  notes?: string;
}

export interface ParsedModelResume {
  latex: string;
  llmMatch?: LlmMatchReport;
}

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || '').trim())
    .filter((s) => s.length >= 1 && s.length <= 60)
    .slice(0, 40);
}

/** Parse optional ===MATCH_REPORT=== JSON block from the model reply. */
export function extractMatchReportFromModelResponse(text: string): LlmMatchReport | undefined {
  const block =
    text.match(/===MATCH_REPORT===\s*([\s\S]*?)\s*===END_MATCH_REPORT===/i)?.[1] ||
    text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (!block) return undefined;

  try {
    const raw = JSON.parse(block.trim()) as Record<string, unknown>;
    const jdSkills = asStringArray(raw.jdSkills ?? raw.keywords ?? raw.allSkills);
    const matched = asStringArray(raw.matched ?? raw.matchedKeywords);
    const missing = asStringArray(raw.missing ?? raw.missingKeywords ?? raw.skillGapKeywords);
    const skillGaps = asStringArray(raw.skillGaps ?? raw.gaps);
    const keywordMatchScore = clampScore(
      raw.keywordMatchScore ?? raw.keywordScore ?? raw.score
    );
    const resumeMatchScore = clampScore(
      raw.resumeMatchScore ?? raw.resumeScore ?? keywordMatchScore
    );
    if (!jdSkills.length && !matched.length && !missing.length) return undefined;
    return {
      jdSkills: jdSkills.length ? jdSkills : [...matched, ...missing],
      matched,
      missing,
      skillGaps,
      keywordMatchScore,
      resumeMatchScore,
      notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 500) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function extractLatexFromModelResponse(text: string): string {
  return parseModelResumeResponse(text).latex;
}

/** Extract LaTeX + optional LLM match/skill-gap report from one model response. */
export function parseModelResumeResponse(text: string): ParsedModelResume {
  const trimmed = text.trim();
  const llmMatch = extractMatchReportFromModelResponse(trimmed);

  // Strip match report so it never lands in LaTeX
  const withoutReport = trimmed
    .replace(/===MATCH_REPORT===[\s\S]*?===END_MATCH_REPORT===/gi, ' ')
    .replace(/```json\s*[\s\S]*?```/gi, (m) =>
      /jdSkills|matched|missing|keywordMatchScore/i.test(m) ? ' ' : m
    )
    .trim();

  let raw = '';
  const fences = [...withoutReport.matchAll(/```(?:latex|tex)?\s*([\s\S]*?)```/gi)];
  if (fences.length) {
    raw = fences[fences.length - 1][1]?.trim() || '';
  } else if (
    /\\documentclass/i.test(withoutReport) ||
    /\\begin\{document\}/i.test(withoutReport) ||
    /\\section/i.test(withoutReport)
  ) {
    raw = withoutReport;
  } else if (withoutReport.length > 200) {
    raw = withoutReport;
  } else {
    throw new Error('No LaTeX found in model response.');
  }

  return {
    latex: enforceAmazonLatex(enforceMasterRules(raw)),
    llmMatch,
  };
}
