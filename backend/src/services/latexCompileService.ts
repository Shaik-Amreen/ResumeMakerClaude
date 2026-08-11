import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';
import { enforceAmazonLatex, getAmazonTemplateLatex, applyJdHeaderTagline } from './resumeAgent/amazonLatexGuard';
import { escapeLatexAmpersands } from './resumeAgent/sanitizeLatex';
import { removeJobResumeFiles } from './resumeFiles';


const PDFLATEX_CANDIDATES = [
  path.join(os.homedir(), 'Library/TinyTeX/bin/universal-darwin/pdflatex'),
  path.join(os.homedir(), 'Library/TinyTeX/bin/x86_64-darwin/pdflatex'),
  '/Library/TeX/texbin/pdflatex',
  '/usr/local/texlive/2025/bin/universal-darwin/pdflatex',
  '/usr/local/texlive/2024/bin/universal-darwin/pdflatex',
  '/opt/homebrew/bin/pdflatex',
  'pdflatex',
];

const TECTONIC_CANDIDATES = [
  '/opt/homebrew/bin/tectonic',
  '/usr/local/bin/tectonic',
  'tectonic',
];

function findBinary(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (candidate.includes('/') || candidate.includes('\\')) {
        if (fs.existsSync(candidate)) return candidate;
      } else {
        execFileSync(candidate, ['--version'], { stdio: 'pipe' });
        return candidate;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function findPdflatex(): string | null {
  return findBinary(PDFLATEX_CANDIDATES);
}

function findTectonic(): string | null {
  return findBinary(TECTONIC_CANDIDATES);
}

/** Strip pdfTeX-only lines so XeTeX/tectonic can compile Jake-style resumes. */
export function adaptLatexForTectonic(latex: string): string {
  return latex
    .replace(/^\s*\\input\{glyphtounicode\}\s*$/gim, '% glyphtounicode omitted (XeTeX)')
    .replace(/^\s*\\pdfgentounicode\s*=\s*1\s*$/gim, '% pdfgentounicode omitted (XeTeX)');
}

/** Wrap Ollama snippets that are not a full LaTeX document. Prefer amazon lock elsewhere. */
export function ensureLatexDocument(latex: string): string {
  const trimmed = latex.trim();
  const hasClass = /\\documentclass/i.test(trimmed);
  const hasBegin = /\\begin\{document\}/i.test(trimmed);
  const hasEnd = /\\end\{document\}/i.test(trimmed);

  if (hasClass && hasBegin && hasEnd) return trimmed;

  if (hasClass && !hasBegin) {
    // Broken model output: documentclass without body — close safely for compile error surfacing
    return `${trimmed}\n\\begin{document}\n\\end{document}\n`;
  }

  if (hasBegin && !hasEnd) {
    return `${trimmed}\n\\end{document}\n`;
  }

  if (!hasClass) {
    return `\\documentclass[letterpaper,11pt]{article}
\\usepackage{times}
\\usepackage[empty]{fullpage}
\\begin{document}
${trimmed}
\\end{document}`;
  }

  return trimmed;
}

export interface CompileResult {
  pdfPath: string;
  texPath: string;
  engine: 'pdflatex' | 'tectonic';
  pageCount: number;
  /** Final LaTeX actually compiled (amazon-locked). */
  latex: string;
}

function readCompileLog(workDir: string, baseName: string): string {
  const logPath = path.join(workDir, `${baseName}.log`);
  if (!fs.existsSync(logPath)) return '';
  const full = fs.readFileSync(logPath, 'utf8');
  const errorLines = full
    .split('\n')
    .filter((l) => /^!/.test(l) || /Error|Emergency stop|Fatal/i.test(l))
    .slice(0, 12);
  if (errorLines.length) return errorLines.join('\n').slice(0, 1500);
  return full.slice(-1500);
}

function compileWithPdflatex(pdflatex: string, workDir: string, baseName: string): void {
  const args = ['-interaction=nonstopmode', '-halt-on-error', `${baseName}.tex`];
  execFileSync(pdflatex, args, { cwd: workDir, stdio: 'pipe', timeout: 120000 });
  execFileSync(pdflatex, args, { cwd: workDir, stdio: 'pipe', timeout: 120000 });
}

function compileWithTectonic(tectonic: string, workDir: string, baseName: string): void {
  execFileSync(tectonic, ['-X', 'compile', '--keep-logs', `${baseName}.tex`], {
    cwd: workDir,
    stdio: 'pipe',
    timeout: 180000,
  });
}

export interface CompileLatexOptions {
  /**
   * When true (manual Recompile from UI), compile the user's LaTeX as written.
   * Skips amazon template lock/fallback so edits show in the PDF.
   */
  preserveUserLatex?: boolean;
  /** Applied after amazon lock so PDF header matches the JD (not Distributed Systems). */
  header?: { title?: string; jobDescription?: string; company?: string };
}

/**
 * Compile LaTeX → PDF.
 * Prefers TinyTeX/BasicTeX pdflatex (matches Amazon/Jake resume templates).
 * Falls back to tectonic with pdfTeX-only lines stripped.
 * Always writes a new timestamped PDF so edits refresh the preview.
 */
export function compileLatexToPdf(
  latex: string,
  jobId: string,
  opts: CompileLatexOptions = {}
): CompileResult {
  const preserveUser = opts.preserveUserLatex === true;
  const pdflatex = findPdflatex();
  const tectonic = findTectonic();

  if (!pdflatex && !tectonic) {
    throw new Error(
      'No PDF engine found. Install TinyTeX (https://yihui.org/tinytex/) or run: brew install tectonic — then restart the backend.'
    );
  }

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `resume-${jobId}-`));
  const baseName = `resume-${jobId}`;
  const texPath = path.join(workDir, `${baseName}.tex`);

  // Pipeline: lock amazon shell. Manual Recompile: use the editor contents as-is.
  let lockedLatex = preserveUser ? latex.trim() : enforceAmazonLatex(latex);
  // Always escape bare & — models often emit "TypeScript &, Java" which breaks pdflatex.
  lockedLatex = escapeLatexAmpersands(lockedLatex);
  if (opts.header && (opts.header.title || opts.header.jobDescription || opts.header.company)) {
    lockedLatex = applyJdHeaderTagline(lockedLatex, opts.header);
  } else if (!preserveUser) {
    // Still strip the generic amazon tagline when we have nothing better —
    // callers should pass header; this is a safety net only for locked compiles.
  }

  let engine: 'pdflatex' | 'tectonic' = pdflatex ? 'pdflatex' : 'tectonic';
  let source =
    engine === 'tectonic'
      ? ensureLatexDocument(adaptLatexForTectonic(lockedLatex))
      : ensureLatexDocument(lockedLatex);

  fs.writeFileSync(texPath, source, 'utf8');

  const tryCompile = (src: string): void => {
    fs.writeFileSync(texPath, src, 'utf8');
    if (engine === 'pdflatex' && pdflatex) {
      compileWithPdflatex(pdflatex, workDir, baseName);
    } else if (tectonic) {
      engine = 'tectonic';
      compileWithTectonic(tectonic, workDir, baseName);
    }
  };

  try {
    tryCompile(source);
  } catch (err) {
    // pdflatex failed → try tectonic with same source
    if (engine === 'pdflatex' && tectonic) {
      try {
        engine = 'tectonic';
        source = ensureLatexDocument(adaptLatexForTectonic(lockedLatex));
        tryCompile(source);
      } catch {
        if (preserveUser) {
          throw new Error(`LaTeX compile failed.\n${readCompileLog(workDir, baseName)}`);
        }
        // Last resort: known-good amazon 2-page template (never ship broken/hallucinated LaTeX)
        console.warn('⚠️ Compile failed — falling back to amazonResumeTemplate.tex');
        lockedLatex = getAmazonTemplateLatex();
        engine = pdflatex ? 'pdflatex' : 'tectonic';
        source =
          engine === 'tectonic'
            ? ensureLatexDocument(adaptLatexForTectonic(lockedLatex))
            : ensureLatexDocument(lockedLatex);
        try {
          tryCompile(source);
        } catch {
          throw new Error(`LaTeX compile failed.\n${readCompileLog(workDir, baseName)}`);
        }
      }
    } else if (preserveUser) {
      const detail = readCompileLog(workDir, baseName) || (err as Error).message;
      throw new Error(`LaTeX compile failed.\n${detail}`);
    } else {
      console.warn('⚠️ Compile failed — falling back to amazonResumeTemplate.tex');
      lockedLatex = getAmazonTemplateLatex();
      engine = pdflatex ? 'pdflatex' : 'tectonic';
      source =
        engine === 'tectonic'
          ? ensureLatexDocument(adaptLatexForTectonic(lockedLatex))
          : ensureLatexDocument(lockedLatex);
      try {
        tryCompile(source);
      } catch {
        const detail = readCompileLog(workDir, baseName) || (err as Error).message;
        throw new Error(`LaTeX compile failed.\n${detail}`);
      }
    }
  }

  const builtPdf = path.join(workDir, `${baseName}.pdf`);
  if (!fs.existsSync(builtPdf)) {
    throw new Error(`LaTeX compile did not produce a PDF.\n${readCompileLog(workDir, baseName)}`);
  }

  const stamp = Date.now();
  const destPdf = path.join(config.uploadsDir, `${jobId}-${stamp}-resume.pdf`);
  const destTex = path.join(config.uploadsDir, `${jobId}-${stamp}-resume.tex`);
  fs.copyFileSync(builtPdf, destPdf);
  fs.copyFileSync(texPath, destTex);
  removeJobResumeFiles(jobId, undefined, [destPdf, destTex]);

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup
  }

  console.log(`📄 PDF compiled with ${engine}: ${path.basename(destPdf)}`);
  const pageCount = countPdfPages(destPdf);
  return { pdfPath: destPdf, texPath: destTex, engine, pageCount, latex: source };
}

/** Count pages in a PDF (pypdf first — reliable for fresh files; then mdls/heuristic). */
export function countPdfPages(pdfPath: string): number {
  try {
    const py = `
import sys
path = sys.argv[1]
try:
    from pypdf import PdfReader
    print(len(PdfReader(path).pages))
    raise SystemExit(0)
except Exception:
    pass
try:
    from Foundation import NSURL
    import Quartz
    url = NSURL.fileURLWithPath_(path)
    pdf = Quartz.PDFDocument.alloc().initWithURL_(url)
    print(int(pdf.pageCount()) if pdf is not None else 0)
except Exception:
    print(0)
`;
    const out = execFileSync('python3', ['-c', py, pdfPath], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const n = Number(out);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through
  }

  try {
    const out = execFileSync('mdls', ['-name', 'kMDItemNumberOfPages', '-raw', pdfPath], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const n = Number(out);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    // fall through
  }

  try {
    const text = fs.readFileSync(pdfPath).toString('latin1');
    const counts = [...text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)].map((m) =>
      Number(m[1])
    );
    if (counts.length) return Math.max(...counts.filter((n) => Number.isFinite(n) && n > 0));
    const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
    return matches?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Detect likely sparse page-2 resumes from LaTeX structure.
 * (PDF text extractors are unavailable in this env; visual gaps usually mean
 * too few bullets/projects, so page 2 only gets pubs/certs.)
 */
export function isResumeContentTooLightForFullTwoPages(latex: string): boolean {
  const items = (latex.match(/\\item\b/g) || []).length;
  const projectTitles = (
    latex.match(/\\uline\{\\textbf\{/g) ||
    latex.match(/\\textbf\{[^}]*(?:NativeNest|Origem|B4IGO|Upturn|Arikya|Project)/gi) ||
    []
  ).length;
  // Rules 21/22: 3–4 bullets/job + 3–4/project → denser floor is lower (~14–24 items, 4–5 projects)
  if (items < 14) return true;
  if (projectTitles < 4) return true;

  // Certs/pubs dominate the tail → page 2 often empty visually
  const certIdx = latex.search(/\\section\{[^}]*Certificat/i);
  const projIdx = latex.search(/\\section\{[^}]*Project/i);
  if (certIdx > 0 && projIdx >= 0) {
    const projectBlock = latex.slice(projIdx, certIdx);
    const projectItems = (projectBlock.match(/\\item\b/g) || []).length;
    if (projectItems < 8) return true;
  }
  return false;
}

/** @deprecated Prefer isResumeContentTooLightForFullTwoPages(latex). PDF path kept for API compat. */
export function isSecondPageSparse(pdfPath: string, latex?: string): boolean {
  if (latex && latex.trim()) return isResumeContentTooLightForFullTwoPages(latex);
  // Without LaTeX we cannot reliably read page-2 text here
  return false;
}

/** Throws if PDF is not exactly 2 pages. */
export function assertExactlyTwoPages(pdfPath: string): number {
  const pages = countPdfPages(pdfPath);
  if (pages !== 2) {
    throw new Error(
      `Resume PDF must be exactly 2 pages (got ${pages || 'unknown'}). Edit LaTeX to fill/trim content, then Build PDF again.`
    );
  }
  return pages;
}
