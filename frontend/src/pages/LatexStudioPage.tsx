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
          : `Compiled: ${result.pageCount}-page PDF preview updated.`
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
      push('system', 'Could not copy: select the LaTeX manually.');
    }
  };

  const previewSrc = pdfUrl
    ? `${UPLOADS_BASE}${pdfUrl}?v=${pdfNonce}`
    : null;

  return (
    <div className="min-h-screen bg-paper text-ink relative font-sans flex flex-col">
      <Background3D />
      <div className="relative z-10 flex flex-col flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 gap-5 min-h-0">
        <header className="shrink-0 animate-fade-up">
          <p className="section-label text-cedar mb-2">Portal resume → amazon.pdf LaTeX</p>
          <h1 className="font-display text-[2rem] md:text-[2.35rem] font-bold tracking-tight text-ink leading-tight">
            Paste → LaTeX Studio
          </h1>
          <p className="text-ink-muted text-sm mt-2 max-w-2xl leading-relaxed">
            Provider: <span className="text-cedar font-semibold">{provider}</span> · Paste from
            another portal, generate LaTeX, chat to revise, Recompile for PDF.
          </p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0 animate-fade-up stagger-1">
          {/* Left: paste + chat */}
          <div className="surface overflow-hidden flex flex-col min-h-[32rem]">
            <div className="p-4 border-b border-paper-line/80 space-y-3 shrink-0 bg-gradient-to-b from-cedar-soft/40 to-transparent">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Role title (optional)"
                  className="rounded-full bg-white/95 border border-paper-line px-3.5 py-2 text-sm text-ink shadow-soft focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-300 ease-apple"
                />
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Company (optional)"
                  className="rounded-full bg-white/95 border border-paper-line px-3.5 py-2 text-sm text-ink shadow-soft focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-300 ease-apple"
                />
                <select
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value as JobType | '')}
                  className="rounded-full bg-white/95 border border-paper-line px-3.5 py-2 text-sm text-ink shadow-soft focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-300 ease-apple"
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
                className="w-full rounded-2xl bg-white/95 border border-paper-line p-3.5 text-sm font-mono text-ink shadow-soft focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-300 ease-apple"
              />
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={3}
                placeholder="Optional: paste JD to tailor skills/bullets…"
                className="w-full rounded-2xl bg-white/95 border border-paper-line p-3.5 text-sm text-ink shadow-soft focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-300 ease-apple"
              />
              <button
                type="button"
                disabled={busy || resumeText.trim().length < 80}
                onClick={generate}
                className="btn-primary inline-flex items-center gap-2 !px-5 !py-2.5 !text-sm"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Generate LaTeX Resume
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white/50">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl px-3.5 py-2.5 text-xs font-medium leading-relaxed whitespace-pre-wrap shadow-soft transition-all duration-300 ease-apple ${
                    m.role === 'user'
                      ? 'bg-cedar-soft border border-cedar/20 text-cedar-ink ml-8'
                      : m.role === 'assistant'
                        ? 'bg-white border border-paper-line text-ink mr-8'
                        : 'bg-mist/80 border border-paper-line text-ink-muted'
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <p className="text-xs text-ink-faint font-medium inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-cedar" /> Generating content…
                </p>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 border-t border-paper-line/80 flex gap-2 shrink-0 bg-white/80">
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
                className="flex-1 rounded-full bg-mist/60 border border-paper-line px-3.5 py-2 text-sm text-ink focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-300 ease-apple disabled:opacity-50"
              />
              <button
                type="button"
                disabled={busy || !latex || !chatInput.trim()}
                onClick={sendChat}
                className="btn-primary inline-flex items-center gap-1.5 !px-4"
              >
                <Send size={14} /> Send
              </button>
            </div>
          </div>

          {/* Right: LaTeX + PDF */}
          <div className="surface overflow-hidden flex flex-col min-h-[32rem]">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 border-b border-paper-line/80 bg-gradient-to-b from-cedar-soft/30 to-transparent shrink-0">
              <div className="flex items-center gap-2 text-sm font-semibold font-display text-ink">
                <FileCode2 size={16} className="text-cedar" />
                LaTeX &amp; PDF
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!latex}
                  onClick={copyLatex}
                  className="chip !py-1.5 !px-3"
                >
                  <Copy size={13} /> Copy
                </button>
                <button
                  type="button"
                  disabled={!latex || recompiling}
                  onClick={recompile}
                  className="btn-primary inline-flex items-center gap-1.5 !py-1.5 !px-4 !text-xs"
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
              <div className="border-b lg:border-b-0 lg:border-r border-paper-line/80 flex flex-col min-h-[18rem]">
                <p className="section-label px-3 py-2 border-b border-paper-line/60">LaTeX source</p>
                <textarea
                  value={latex}
                  onChange={(e) => setLatex(e.target.value)}
                  spellCheck={false}
                  placeholder="Generated LaTeX appears here…"
                  className="flex-1 w-full p-3 text-xs font-mono bg-white/70 focus:outline-none resize-none min-h-[16rem]"
                />
              </div>
              <div className="flex flex-col min-h-[18rem] bg-mist/30">
                <div className="flex items-center justify-between px-3 py-2 border-b border-paper-line/60">
                  <p className="section-label inline-flex items-center gap-1.5 normal-case tracking-normal">
                    <FileText size={12} className="text-cedar" /> PDF preview
                  </p>
                  {previewSrc && (
                    <a
                      href={previewSrc}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-semibold text-cedar hover:text-cedar-ink transition-colors"
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
