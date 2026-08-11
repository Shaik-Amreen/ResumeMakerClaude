import type { Job, JobStatus } from '../types';
import { statusLabel } from '../utils/statusUi';

type ColumnId = 'inbox' | 'ready' | 'applying' | 'applied' | 'interview' | 'hold' | 'won';

const COLUMNS: { id: ColumnId; title: string; statuses: JobStatus[] }[] = [
  {
    id: 'inbox',
    title: 'Inbox',
    statuses: ['scraped', 'resume_generating', 'resume_generated', 'pending_resume_approval'],
  },
  { id: 'ready', title: 'Ready', statuses: ['pdf_uploaded'] },
  {
    id: 'applying',
    title: 'Applying',
    statuses: ['applying', 'pending_message_approval', 'pending_submit_approval'],
  },
  { id: 'applied', title: 'Applied', statuses: ['applied'] },
  { id: 'interview', title: 'Interview', statuses: ['assessment', 'interview'] },
  { id: 'hold', title: 'Hold / Failed', statuses: ['confused_hold', 'failed', 'invalid_job'] },
  { id: 'won', title: 'Offer', statuses: ['accepted'] },
];

const DROP_STATUS: Record<ColumnId, JobStatus> = {
  inbox: 'scraped',
  ready: 'pdf_uploaded',
  applying: 'applying',
  applied: 'applied',
  interview: 'interview',
  hold: 'confused_hold',
  won: 'accepted',
};

interface Props {
  jobs: Job[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, status: JobStatus) => void;
}

function columnFor(job: Job): ColumnId {
  for (const c of COLUMNS) {
    if (c.statuses.includes(job.status)) return c.id;
  }
  return 'inbox';
}

function stars(n?: number) {
  if (!n) return null;
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

/** Huntr-style Kanban for pipeline visibility. */
export function PipelineBoard({ jobs, selectedId, onSelect, onMove }: Props) {
  return (
    <div className="surface p-3 overflow-x-auto animate-fade-up">
      <div className="flex gap-3 min-w-max pb-1">
        {COLUMNS.map((col) => {
          const items = jobs
            .filter((j) => columnFor(j) === col.id)
            .sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0));
          return (
            <div
              key={col.id}
              className="w-[220px] shrink-0 rounded-2xl bg-mist/50 border border-paper-line/70 flex flex-col max-h-[70vh]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/job-id');
                if (id) onMove(id, DROP_STATUS[col.id]);
              }}
            >
              <div className="px-3 py-2.5 border-b border-paper-line/60 flex items-center justify-between sticky top-0 bg-mist/80 backdrop-blur-sm rounded-t-2xl">
                <p className="text-[11px] font-bold font-display text-ink tracking-tight">
                  {col.title}
                </p>
                <span className="text-[10px] font-semibold tabular-nums text-ink-faint bg-white/80 px-2 py-0.5 rounded-full border border-paper-line">
                  {items.length}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {items.map((job) => {
                  const active = job._id === selectedId;
                  return (
                    <button
                      key={job._id}
                      type="button"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/job-id', job._id)}
                      onClick={() => onSelect(job._id)}
                      className={`w-full text-left rounded-xl border px-2.5 py-2 transition-all duration-300 ease-apple ${
                        active
                          ? 'bg-cedar-soft border-cedar/30 shadow-soft'
                          : 'bg-white/90 border-paper-line hover:border-cedar/25 hover:shadow-soft'
                      }`}
                    >
                      <p className="text-[11px] font-semibold text-ink line-clamp-2 leading-snug">
                        {job.title}
                      </p>
                      <p className="text-[10px] text-ink-muted mt-0.5 truncate">{job.company}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[9px] font-semibold text-ink-faint">
                          {statusLabel(job.status)}
                        </span>
                        {(job.matchScore != null || job.keywordMatchScore != null) && (
                          <span className="text-[9px] font-bold text-emerald-800">
                            {job.matchScore ?? job.keywordMatchScore}%
                          </span>
                        )}
                        {job.interest ? (
                          <span className="text-[9px] text-amber-700 tracking-tight">
                            {stars(job.interest)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
                {items.length === 0 && (
                  <p className="text-[10px] text-ink-faint text-center py-6">Drop cards here</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
