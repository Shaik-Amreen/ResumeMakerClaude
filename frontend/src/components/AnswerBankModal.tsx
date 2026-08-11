import { useEffect, useState } from 'react';
import { Copy, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { api } from '../api';

interface Row {
  question: string;
  questionNorm: string;
  answer: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Screening Q&A bank — top request after autofill in Simplify/JobWizard reviews. */
export function AnswerBankModal({ open, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getAnswers();
      setRows(r.answers || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load answers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/35 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-hidden bg-white/95 backdrop-blur-xl rounded-[1.5rem] shadow-float border border-white/80 flex flex-col animate-scale-in"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-paper-line/80">
          <div>
            <h3 className="text-lg font-bold font-display text-ink tracking-tight">Answer bank</h3>
            <p className="text-xs text-ink-muted mt-1">
              Save screening answers once — reuse across Greenhouse, Lever, Workday, and Simplify.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-ink-faint hover:bg-mist hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-paper-line/60 space-y-2 shrink-0">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Question (e.g. Years of React experience?)"
            className="w-full rounded-full border border-paper-line px-3.5 py-2 text-sm focus:outline-none focus:border-cedar focus:shadow-ring"
          />
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={2}
            placeholder="Your answer…"
            className="w-full rounded-2xl border border-paper-line px-3.5 py-2 text-sm focus:outline-none focus:border-cedar focus:shadow-ring"
          />
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5"
            onClick={async () => {
              if (!question.trim() || !answer.trim()) return;
              try {
                await api.saveAnswer(question.trim(), answer.trim());
                setQuestion('');
                setAnswer('');
                toast.success('Answer saved');
                await load();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Save failed');
              }
            }}
          >
            <Plus size={14} /> Save answer
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading ? (
            <p className="text-sm text-ink-muted py-8 text-center">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink-muted py-8 text-center">No answers yet.</p>
          ) : (
            rows.map((r) => (
              <div
                key={r.questionNorm}
                className="rounded-2xl border border-paper-line bg-white/80 px-3.5 py-3 space-y-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-ink">{r.question}</p>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      className="p-1.5 rounded-full hover:bg-mist text-ink-faint"
                      title="Copy answer"
                      onClick={async () => {
                        await navigator.clipboard.writeText(r.answer);
                        toast.success('Copied');
                      }}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-full hover:bg-red-50 text-ink-faint hover:text-red-700"
                      title="Delete custom answer"
                      onClick={async () => {
                        try {
                          await api.deleteAnswer(r.questionNorm);
                          await load();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Delete failed');
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-ink-muted whitespace-pre-wrap">{r.answer}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
