import { useState } from 'react';
import { api, UPLOADS_BASE } from '../api';

export function LatexStudioPage() {
  const [resumeText, setResumeText] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [latex, setLatex] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('Paste a resume (and optional JD), then Generate LaTeX.');
  const [pdfNonce, setPdfNonce] = useState(0);

  const generate = async () => {
    if (resumeText.trim().length < 80) {
      setNote('Paste a fuller resume first (~80+ characters).');
      return;
    }
    setBusy(true);
    setNote('Generating LaTeX…');
    try {
      const result = await api.resumeFromPaste({
        resumeText,
        jobDescription: jobDescription.trim() || undefined,
      });
      setLatex(result.latex || '');
      setNote(`LaTeX ready (${result.latexChars ?? (result.latex || '').length} chars). Click Recompile for PDF.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  };

  const recompile = async () => {
    if (!latex.trim()) {
      setNote('Generate or paste LaTeX first.');
      return;
    }
    setBusy(true);
    setNote('Compiling PDF…');
    try {
      const result = await api.compileResumeLatex(latex);
      setPdfUrl(result.pdfUrl);
      setPdfNonce((n) => n + 1);
      setNote(`Compiled — ${result.pageCount}-page PDF.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Compile failed');
    } finally {
      setBusy(false);
    }
  };

  const previewSrc = pdfUrl ? `${UPLOADS_BASE}${pdfUrl}?v=${pdfNonce}` : null;

  return (
    <div className="flex-1 min-h-0 max-w-[1600px] w-full mx-auto p-4 md:p-6 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">LaTeX Studio</h1>
        <p className="text-sm text-slate-600 mt-1">
          Portal resume → amazon.pdf-style LaTeX → PDF. Optional JD to tailor.
        </p>
        <p className="text-xs text-teal-800 mt-2 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
          {note}
        </p>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3 min-h-0">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Paste resume
          </label>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            className="flex-1 min-h-[12rem] rounded-xl border border-slate-200 bg-white p-3 text-sm"
            placeholder="Paste resume text from LinkedIn / Jobright / Word…"
          />
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Optional JD
          </label>
          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="h-28 rounded-xl border border-slate-200 bg-white p-3 text-sm"
            placeholder="Paste job description to tailor…"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void generate()}
              className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm disabled:opacity-50"
            >
              Generate LaTeX
            </button>
            <button
              type="button"
              disabled={busy || !latex.trim()}
              onClick={() => void recompile()}
              className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm disabled:opacity-50"
            >
              Recompile PDF
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 min-h-0">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            LaTeX
          </label>
          <textarea
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            className="flex-1 min-h-[12rem] rounded-xl border border-slate-200 bg-white p-3 text-xs font-mono"
            spellCheck={false}
          />
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            PDF preview
          </label>
          {previewSrc ? (
            <iframe title="Studio PDF" src={previewSrc} className="h-72 rounded-xl border border-slate-200 bg-white" />
          ) : (
            <div className="h-40 rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-sm text-slate-400">
              No PDF yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
