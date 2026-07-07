import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';

const PDFLATEX_CANDIDATES = [
  '/Library/TeX/texbin/pdflatex',
  '/usr/local/texlive/2024/bin/universal-darwin/pdflatex',
  'pdflatex',
];

function findPdflatex(): string | null {
  for (const candidate of PDFLATEX_CANDIDATES) {
    try {
      if (candidate.includes('/')) {
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

/** Wrap Ollama snippets that are not a full LaTeX document. */
export function ensureLatexDocument(latex: string): string {
  const trimmed = latex.trim();
  if (/\\documentclass/i.test(trimmed)) return trimmed;
  return `\\documentclass[11pt]{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\begin{document}
${trimmed}
\\end{document}`;
}

export interface CompileResult {
  pdfPath: string;
  texPath: string;
}

export function compileLatexToPdf(latex: string, jobId: string): CompileResult {
  const pdflatex = findPdflatex();
  if (!pdflatex) {
    throw new Error(
      'pdflatex not found. Install BasicTeX (macOS: brew install --cask basictex), then restart the backend — or upload a PDF manually.'
    );
  }

  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `resume-${jobId}-`));
  const baseName = `resume-${jobId}`;
  const texPath = path.join(workDir, `${baseName}.tex`);
  const document = ensureLatexDocument(latex);

  fs.writeFileSync(texPath, document, 'utf8');

  try {
    execFileSync(pdflatex, ['-interaction=nonstopmode', '-halt-on-error', `${baseName}.tex`], {
      cwd: workDir,
      stdio: 'pipe',
      timeout: 120000,
    });
    execFileSync(pdflatex, ['-interaction=nonstopmode', '-halt-on-error', `${baseName}.tex`], {
      cwd: workDir,
      stdio: 'pipe',
      timeout: 120000,
    });
  } catch (err) {
    const logPath = path.join(workDir, `${baseName}.log`);
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-2000) : '';
    throw new Error(`LaTeX compile failed. ${log || (err as Error).message}`);
  }

  const builtPdf = path.join(workDir, `${baseName}.pdf`);
  if (!fs.existsSync(builtPdf)) {
    throw new Error('LaTeX compile did not produce a PDF.');
  }

  const destPdf = path.join(config.uploadsDir, `${jobId}-${Date.now()}-resume.pdf`);
  const destTex = path.join(config.uploadsDir, `${jobId}-${Date.now()}-resume.tex`);
  fs.copyFileSync(builtPdf, destPdf);
  fs.copyFileSync(texPath, destTex);

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup
  }

  return { pdfPath: destPdf, texPath: destTex };
}
