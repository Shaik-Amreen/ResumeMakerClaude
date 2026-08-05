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
  const trimmed = unwrapClaudeCliText(text).trim();
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
    // Prefer the fence that looks most like resume LaTeX
    const ranked = fences
      .map((m) => (m[1] || '').trim())
      .filter(Boolean)
      .sort((a, b) => latexSignalScore(b) - latexSignalScore(a));
    raw = ranked[0] || '';
  } else if (
    /\\documentclass/i.test(withoutReport) ||
    /\\begin\{document\}/i.test(withoutReport) ||
    /\\section/i.test(withoutReport)
  ) {
    raw = withoutReport;
  } else if (latexSignalScore(withoutReport) >= 2 || withoutReport.length > 400) {
    raw = withoutReport;
  } else {
    const preview = withoutReport.replace(/\s+/g, ' ').slice(0, 240);
    throw new Error(
      `No LaTeX found in model response.${preview ? ` Preview: ${preview}` : ' (empty)'}`
    );
  }

  return {
    latex: enforceAmazonLatex(enforceMasterRules(raw)),
    llmMatch,
  };
}

/** Claude CLI sometimes wraps text in JSON even with --output-format text. */
function unwrapClaudeCliText(text: string): string {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return t;
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    for (const key of ['result', 'content', 'text', 'message', 'output']) {
      const v = parsed[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    // Anthropic-style content blocks
    const content = parsed.content;
    if (Array.isArray(content)) {
      const joined = content
        .map((b) => {
          if (typeof b === 'string') return b;
          if (b && typeof b === 'object' && typeof (b as { text?: string }).text === 'string') {
            return (b as { text: string }).text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (joined.trim()) return joined;
    }
  } catch {
    // not JSON — use as-is
  }
  return t;
}

function latexSignalScore(s: string): number {
  let score = 0;
  if (/\\section/i.test(s)) score += 3;
  if (/\\textbf/i.test(s)) score += 2;
  if (/\\begin\{itemize\}/i.test(s)) score += 2;
  if (/\\href/i.test(s)) score += 1;
  if (/\\hfill/i.test(s)) score += 1;
  if (/Work Experience|Key Projects|Certifications/i.test(s)) score += 1;
  return score;
}
