import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2, Send, FileCode2, FileText, Sparkles } from 'lucide-react';
import { Background3D } from '../components/Background3D';
import { api, UPLOADS_BASE } from '../api';
import type { JobType } from '../types';

type ChatRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function LatexStudioPage() {
  const [provider, setProvider] = useState('…');
  const [resumeText, setResumeText] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [jobType, setJobType] = useState<JobType | ''>('fulltime');
  const [latex, setLatex] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfNonce, setPdfNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recompiling, setRecompiling] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'system',
      text: 'Paste a resume from any portal (LinkedIn, Jobright, Word, etc.). Optionally add a JD to tailor. Click Generate LaTeX, then Recompile for the PDF. Use the chat box for follow-ups like “lead with PHP” or “shorten projects”.',
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getResumeProvider().then((r) => setProvider(r.provider)).catch(() => setProvider('unknown'));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const push = (role: ChatRole, text: string) => {
    setMessages((m) => [...m, { id: uid(), role, text }]);
  };

  const generate = async () => {
    if (resumeText.trim().length < 80) {
      push('system', 'Paste a fuller resume first (need ~80+ characters).');
      return;
    }
    setBusy(true);
    push('user', `Generate LaTeX from pasted resume${jobDescription.trim() ? ' + JD' : ''}.`);
    try {
      const result = await api.resumeFromPaste({
        resumeText,
        jobDescription: jobDescription.trim() || undefined,
        title: title.trim() || undefined,
        company: company.trim() || undefined,
        jobType: jobType || undefined,
      });
      setLatex(result.latex);
      setPdfUrl(null);
      push(
        'assistant',
        `LaTeX ready via ${result.provider} (${result.latexChars} chars)${
          result.matchScore != null ? ` · JD match ${result.matchScore}%` : ''
        }. Click Recompile to build the PDF.`
      );
    } catch (e) {
      push('system', e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  const sendChat = async () => {
    const message = chatInput.trim();
    if (!message) return;
    if (!latex.trim()) {
      push('system', 'Generate LaTeX first, then chat to revise it.');
      return;
    }
    setChatInput('');
    setBusy(true);
    push('user', message);
    try {
      const result = await api.resumePasteChat({
        latex,
        message,
        jobDescription: jobDescription.trim() || undefined,
        title: title.trim() || undefined,
        company: company.trim() || undefined,
        jobType: jobType || undefined,
      });
      setLatex(result.latex);
      setPdfUrl(null);
      push('assistant', `Updated LaTeX (${result.latexChars} chars). Recompile to refresh the PDF.`);
    } catch (e) {
      push('system', e instanceof Error ? e.message : 'Chat failed');
    } finally {
      setBusy(false);
    }
  };

  const recompile = async () => {
    if (!latex.trim()) {
      push('system', 'No LaTeX to compile yet.');
      return;
    }
    setRecompiling(true);
    try {
      const result = await api.compileResumeLatex(latex);
      setPdfUrl(result.pdfUrl);
      setPdfNonce((n) => n + 1);
      push(
        'assistant',
        result.warning
          ? `Compiled (${result.pageCount} pages). ${result.warning}`
          : `Compiled — ${result.pageCount}-page PDF preview updated.`
      );
    } catch (e) {
      push('system', e instanceof Error ? e.message : 'Compile failed');
    } finally {
      setRecompiling(false);
    }
  };

  const copyLatex = async () => {
    try {
      await navigator.clipboard.writeText(latex);
      push('system', 'LaTeX copied to clipboard.');
    } catch {
      push('system', 'Could not copy — select the LaTeX manually.');
    }
  };

  const previewSrc = pdfUrl
    ? `${UPLOADS_BASE}${pdfUrl}?v=${pdfNonce}`
    : null;

  return (
    <div className="min-h-screen bg-paper text-ink relative font-sans flex flex-col">
      <Background3D />
      <div className="relative z-10 flex flex-col flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 gap-4 min-h-0">
        <header className="shrink-0">
          <p className="text-primary-500 text-sm font-medium tracking-widest uppercase mb-1">
            Portal resume → amazon.pdf LaTeX
          </p>
          <h1 className="text-3xl font-bold text-ink">Paste → LaTeX Studio</h1>
          <p className="text-ink-muted text-sm mt-1">
            Provider: <span className="text-primary-500 font-medium">{provider}</span> · Paste from
            another portal, generate LaTeX, chat to revise, Recompile for PDF.
          </p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0">
          {/* Left: paste + chat */}
          <div className="glass rounded-2xl flex flex-col overflow-hidden min-h-[32rem]">
            <div className="p-4 border-b border-slate-200 space-y-3 shrink-0 bg-gradient-to-r from-teal-50/80 to-sky-50/60">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Role title (optional)"
                  className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company (optional)"
                  className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                />
                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value as JobType | '')}
                  className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="internship">Internship</option>
                  <option value="fulltime">Full-time</option>
                  <option value="">Unspecified</option>
                </select>
              </div>
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={6}
                placeholder="Paste resume text from LinkedIn / Jobright / Word / PDF copy…"
                className="w-full rounded-xl bg-white border border-slate-200 p-3 text-sm font-mono"
              />
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={3}
                placeholder="Optional: paste JD to tailor skills/bullets…"
                className="w-full rounded-xl bg-white border border-slate-200 p-3 text-sm"
              />
              <button
                type="button"
                disabled={busy || resumeText.trim().length < 80}
                onClick={generate}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-accent-hover disabled:opacity-40 shadow-sm"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Generate LaTeX
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white/70">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-teal-50 border border-teal-200 text-teal-950 ml-8'
                      : m.role === 'assistant'
                        ? 'bg-sky-50 border border-sky-200 text-sky-950 mr-8'
                        : 'bg-slate-50 border border-slate-200 text-ink-muted'
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <p className="text-xs text-ink-faint inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Working…
                </p>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 border-t border-slate-200 flex gap-2 shrink-0 bg-white">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendChat();
                  }
                }}
                disabled={busy || !latex}
                placeholder="Chat: e.g. put PHP first in skills…"
                className="flex-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
              />
              <button
                type="button"
                disabled={busy || !latex || !chatInput.trim()}
                onClick={sendChat}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 text-white text-sm font-medium disabled:opacity-40"
              >
                <Send size={15} /> Send
              </button>
            </div>
          </div>

          {/* Right: LaTeX + PDF */}
          <div className="glass rounded-2xl flex flex-col overflow-hidden min-h-[32rem]">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-slate-200 bg-violet-50/50 shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <FileCode2 size={16} className="text-violet-600" />
                LaTeX &amp; PDF
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!latex}
                  onClick={copyLatex}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-200 text-ink-muted disabled:opacity-40"
                >
                  <Copy size={13} /> Copy
                </button>
                <button
                  type="button"
                  disabled={!latex || recompiling}
                  onClick={recompile}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-40"
                >
                  {recompiling ? (
                    <>
                      <Loader2 size={13} className="animate-spin" /> Compiling…
                    </>
                  ) : (
                    'Recompile'
                  )}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 flex-1 min-h-0">
              <div className="border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-h-[18rem]">
                <p className="text-[10px] uppercase tracking-wide text-violet-700 px-2 py-1.5 border-b border-slate-100">
                  LaTeX source
                </p>
                <textarea
                  value={latex}
                  onChange={(e) => setLatex(e.target.value)}
                  spellCheck={false}
                  placeholder="Generated LaTeX appears here…"
                  className="flex-1 w-full p-2 text-xs font-mono bg-white focus:outline-none resize-none min-h-[16rem]"
                />
              </div>
              <div className="flex flex-col min-h-[18rem] bg-sky-50/30">
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100">
                  <p className="text-[10px] uppercase tracking-wide text-sky-700 inline-flex items-center gap-1">
                    <FileText size={12} /> PDF preview
                  </p>
                  {previewSrc && (
                    <a
                      href={previewSrc}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary-500"
                    >
                      Open
                    </a>
                  )}
                </div>
                {previewSrc ? (
                  <iframe
                    key={previewSrc}
                    title="Studio PDF"
                    src={previewSrc}
                    className="flex-1 w-full min-h-[16rem] bg-white"
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-ink-faint px-4 text-center">
                    Generate LaTeX, then click Recompile.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
