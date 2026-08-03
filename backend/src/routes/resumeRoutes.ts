import { Router, Request, Response } from 'express';
import path from 'path';
import {
  generateResumeLatex,
  reviseResumeLatex,
  resumeAgentLabel,
  generateLatexFromPaste,
} from '../services/resumeAgent';
import { scoreResumeAgainstJd, injectMissingJdKeywords, mergeLlmAndRegexMatch } from '../services/resumeAgent/jdMatch';
import { cleanJobDescriptionForResume } from '../services/cleanJobDescription';
import { applyJdHeaderTagline } from '../services/resumeAgent/amazonLatexGuard';
import { compileLatexToPdf } from '../services/latexCompileService';
import { sanitizeResumeLatex } from '../services/resumeAgent/sanitizeLatex';
import type { JobType } from '../models/Job';

const router = Router();

function parseJobType(raw: unknown): JobType | undefined {
  if (raw === 'fulltime') return 'fulltime';
  if (raw === 'internship') return 'internship';
  return undefined;
}

/** Pull JD + metadata from JSON, urlencoded form, or raw text/plain body. */
function extractFromJdInput(req: Request): {
  jobDescription: string;
  title?: string;
  company?: string;
  jobType?: JobType;
} {
  if (typeof req.body === 'string') {
    return { jobDescription: req.body };
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const jobDescription = String(
    body.jobDescription || body.jd || body.description || ''
  ).trim();

  return {
    jobDescription,
    title: body.title ? String(body.title) : undefined,
    company: body.company ? String(body.company) : undefined,
    jobType: parseJobType(body.jobType),
  };
}

function extractPasteInput(req: Request): {
  resumeText: string;
  jobDescription?: string;
  title?: string;
  company?: string;
  jobType?: JobType;
  message?: string;
  latex?: string;
} {
  if (typeof req.body === 'string') {
    return { resumeText: req.body };
  }
  const body = (req.body || {}) as Record<string, unknown>;
  return {
    resumeText: String(body.resumeText || body.resume || body.text || '').trim(),
    jobDescription: body.jobDescription
      ? String(body.jobDescription)
      : body.jd
        ? String(body.jd)
        : undefined,
    title: body.title ? String(body.title) : undefined,
    company: body.company ? String(body.company) : undefined,
    jobType: parseJobType(body.jobType),
    message: body.message ? String(body.message) : undefined,
    latex: body.latex ? String(body.latex) : undefined,
  };
}

function looksLikeUntailoredTemplate(latex: string, jd: string): boolean {
  const jdLower = jd.toLowerCase();
  const wantsPhp = /\bphp\b/i.test(jdLower);
  const wantsHtml = /\bhtml\b/i.test(jdLower);
  const skillsBlock =
    latex.match(
      /\\section\{\\textbf\{Technical Skills\}\}([\s\S]*?)\\section\{\\textbf\{Professional Experience\}\}/i
    )?.[1] || '';

  if (wantsPhp && !/\bPHP\b/.test(skillsBlock) && !/\bPHP\b/.test(latex)) return true;
  if (wantsHtml && !/HTML/i.test(latex)) return true;
  return false;
}

function isFullEnough(match: { score: number; missing: string[]; keywords: string[] }): boolean {
  if (match.keywords.length === 0) return true;
  if (match.score >= 85) return true;
  return match.missing.length === 0;
}

async function handleFromJd(req: Request, res: Response) {
  try {
    const input = extractFromJdInput(req);
    const cleaned = cleanJobDescriptionForResume(input.jobDescription);

    if (!cleaned || cleaned.length < 40) {
      return res.status(400).json({
        message:
          'jobDescription is required (min ~40 characters after cleaning). ' +
          'Tip: in Swagger use application/x-www-form-urlencoded so newlines paste safely.',
      });
    }

    const ctx = {
      jobDescription: cleaned,
      title: input.title,
      company: input.company,
      jobType: input.jobType,
    };

    const provider = resumeAgentLabel();
    console.log(
      `\n🧪 API from-jd via ${provider}${input.title ? ` — ${input.title}` : ''} (${cleaned.length} chars cleaned)`
    );

    let generated = await generateResumeLatex(ctx);
    let latex = generated.latex;
    let match = scoreResumeAgainstJd(cleaned, latex);
    if (generated.llmMatch) {
      match = mergeLlmAndRegexMatch(generated.llmMatch, match).match;
    }

    if (looksLikeUntailoredTemplate(latex, cleaned) || match.score < 70) {
      console.warn(
        `⚠️ from-jd looks under-tailored (score ${match.score}%) — forcing JD rewrite pass…`
      );
      latex = await reviseResumeLatex(
        ctx,
        latex,
        [
          'This resume still looks like the generic amazon template.',
          'REWRITE Technical Skills so REQUIRED JD skills come first (e.g. PHP, HTML, CSS, JavaScript, REST, third-party APIs).',
          'REPLACE project tech stacks so at least 2 projects include the JD backend (PHP if required) + HTML/CSS/JS as appropriate. Keep project names and URLs.',
          'REWRITE experience bullets to evidence those JD skills.',
          match.missing.length
            ? `Missing keywords to cover: ${match.missing.slice(0, 15).join(', ')}.`
            : '',
          'Output section body from \\section{\\textbf{Education}} only.',
          'Do not put any job title or skills line in the header.',
          'Append ===MATCH_REPORT=== JSON after the LaTeX.',
        ]
          .filter(Boolean)
          .join(' ')
      );
      match = scoreResumeAgainstJd(cleaned, latex);
    }

    if (!isFullEnough(match)) {
      latex = injectMissingJdKeywords(latex, match.missing);
      match = scoreResumeAgainstJd(cleaned, latex);
    }

    latex = applyJdHeaderTagline(latex, {
      title: input.title,
      jobDescription: cleaned,
    });

    res.json({
      provider,
      latex,
      matchScore: generated.llmMatch?.resumeMatchScore ?? match.score,
      keywordMatchScore: generated.llmMatch?.keywordMatchScore ?? match.score,
      missingKeywords: match.missing.slice(0, 20),
      matchedKeywords: match.matched.slice(0, 20),
      skillGaps: generated.llmMatch?.skillGaps?.slice(0, 12) || [],
      latexChars: latex.length,
      cleanedJdChars: cleaned.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resume generation failed';
    console.error('from-jd error:', error);
    res.status(500).json({ message });
  }
}

async function handleFromPaste(req: Request, res: Response) {
  try {
    const input = extractPasteInput(req);
    if (!input.resumeText || input.resumeText.length < 80) {
      return res.status(400).json({
        message: 'resumeText is required (paste a full resume, min ~80 characters).',
      });
    }

    const cleanedJd = input.jobDescription
      ? cleanJobDescriptionForResume(input.jobDescription)
      : undefined;

    const provider = resumeAgentLabel();
    let latex = await generateLatexFromPaste({
      resumeText: input.resumeText,
      jobDescription: cleanedJd,
      title: input.title,
      company: input.company,
      jobType: input.jobType,
    });

    // Always rewrite the locked amazon header when we have role/JD context.
    latex = applyJdHeaderTagline(latex, {
      title: input.title,
      jobDescription: cleanedJd || input.resumeText.slice(0, 2000),
      company: input.company,
    });

    let matchScore: number | undefined;
    let matchedKeywords: string[] | undefined;
    let missingKeywords: string[] | undefined;
    if (cleanedJd) {
      const match = scoreResumeAgainstJd(cleanedJd, latex);
      matchScore = match.score;
      matchedKeywords = match.matched.slice(0, 20);
      missingKeywords = match.missing.slice(0, 20);
    }

    res.json({
      provider,
      latex,
      matchScore,
      matchedKeywords,
      missingKeywords,
      latexChars: latex.length,
      resumeChars: input.resumeText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Paste→LaTeX failed';
    console.error('from-paste error:', error);
    res.status(500).json({ message });
  }
}

/** Follow-up chat turn: revise existing LaTeX with a user message. */
async function handlePasteChat(req: Request, res: Response) {
  try {
    const input = extractPasteInput(req);
    const latex = (input.latex || '').trim();
    const message = (input.message || '').trim();
    if (!latex || latex.length < 200) {
      return res.status(400).json({ message: 'latex is required (generate first).' });
    }
    if (!message) {
      return res.status(400).json({ message: 'message is required.' });
    }

    const cleanedJd = input.jobDescription
      ? cleanJobDescriptionForResume(input.jobDescription)
      : 'General software engineering role.';

    const ctx = {
      jobDescription: cleanedJd,
      title: input.title,
      company: input.company,
      jobType: input.jobType,
    };

    const revised = await reviseResumeLatex(
      ctx,
      latex,
      [
        'Revise the LaTeX based on this user request. Keep amazon.pdf structure and KARTHIK KOVI.',
        'Output section body from \\section{\\textbf{Education}} only.',
        `USER REQUEST: ${message}`,
      ].join('\n')
    );

    const withHeader = applyJdHeaderTagline(revised, {
      title: input.title,
      jobDescription: cleanedJd,
      company: input.company,
    });

    res.json({
      provider: resumeAgentLabel(),
      latex: withHeader,
      latexChars: withHeader.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat revise failed';
    console.error('paste-chat error:', error);
    res.status(500).json({ message });
  }
}

async function handleCompile(req: Request, res: Response) {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const latex = sanitizeResumeLatex(String(body.latex || '').trim());
    if (!latex || latex.length < 100) {
      return res.status(400).json({ message: 'latex is required.' });
    }

    const studioId = `studio-${Date.now()}`;
    const { pdfPath, pageCount } = compileLatexToPdf(latex, studioId, {
      preserveUserLatex: true,
    });
    const pdfUrl = `/uploads/${path.basename(pdfPath)}`;

    res.json({
      pdfUrl,
      pageCount,
      warning:
        pageCount !== 2
          ? `PDF is ${pageCount} page(s) — aim for exactly 2.`
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Compile failed';
    console.error('resume compile error:', error);
    res.status(422).json({ message });
  }
}

router.post('/from-jd', handleFromJd);
router.post('/from-paste', handleFromPaste);
router.post('/paste-chat', handlePasteChat);
router.post('/compile', handleCompile);

router.get('/provider', (_req: Request, res: Response) => {
  res.json({ provider: resumeAgentLabel() });
});

export default router;
