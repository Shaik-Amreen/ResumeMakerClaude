import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Download,
  Flame,
  Keyboard,
  LayoutGrid,
  Library,
  List,
  ListChecks,
  Sparkles,
  Trophy,
} from 'lucide-react';
import type { JobFilters } from '../utils/jobFilters';
import type { SearchInsights } from '../utils/searchInsights';

interface Props {
  filters: JobFilters;
  onChange: (next: JobFilters) => void;
  queueCount: number;
  needsYou: number;
  readyApply: number;
  scraped: number;
  insights: SearchInsights;
  viewMode: 'list' | 'board';
  onViewMode: (m: 'list' | 'board') => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onFollowUps: () => void;
  onHighInterest: () => void;
  onExport: () => void;
  onOpenAnswers: () => void;
}

const PRESETS: { id: string; label: string; patch: Partial<JobFilters> }[] = [
  { id: 'queue', label: 'Today', patch: { status: 'action_queue', sort: 'action', search: '' } },
  { id: 'needs', label: 'Needs you', patch: { status: 'needs_you', sort: 'action', search: '' } },
  { id: 'ready', label: 'Ready', patch: { status: 'ready_apply', sort: 'newest', search: '' } },
  { id: 'scraped', label: 'Scraped', patch: { status: 'scraped', sort: 'newest', search: '' } },
  { id: 'all', label: 'All', patch: { status: 'all', sort: 'priority', search: '' } },
];

function activePreset(filters: JobFilters): string {
  if (filters.status === 'action_queue') return 'queue';
  if (filters.status === 'needs_you') return 'needs';
  if (filters.status === 'ready_apply') return 'ready';
  if (filters.status === 'scraped') return 'scraped';
  if (filters.status === 'all') return 'all';
  return '';
}

/** Single compact toolbar: queue presets + insights + view + nav. */
export function WorkQueueBar({
  filters,
  onChange,
  queueCount,
  needsYou,
  readyApply,
  scraped,
  insights,
  viewMode,
  onViewMode,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onFollowUps,
  onHighInterest,
  onExport,
  onOpenAnswers,
}: Props) {
  const active = activePreset(filters);
  const counts: Record<string, number | undefined> = {
    queue: queueCount,
    needs: needsYou,
    ready: readyApply,
    scraped,
  };
  const followUps = insights.followUpsDue + insights.staleApplied;

  return (
    <div className="surface toolbar !bg-white/55 px-3 py-2.5 space-y-2 shrink-0">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold font-display text-ink shrink-0">
            <ListChecks size={13} className="text-cedar" />
            Queue
          </span>
          <div className="inline-flex flex-wrap gap-0.5 p-0.5 rounded-full bg-mist/80 border border-paper-line/80">
            {PRESETS.map((p) => {
              const isOn = active === p.id;
              const n = counts[p.id];
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange({ ...filters, ...p.patch })}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-200 ${
                    isOn ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink hover:bg-white/80'
                  }`}
                >
                  {p.label}
                  {typeof n === 'number' ? (
                    <span className={`ml-1 tabular-nums ${isOn ? 'text-white/65' : 'text-ink-faint'}`}>
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-ink-faint">
            <Keyboard size={11} /> J/K
          </span>
          <div className="inline-flex rounded-full border border-paper-line bg-white overflow-hidden">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canPrev}
              className="px-2 py-1.5 text-ink-muted hover:bg-mist disabled:opacity-35"
              title="Previous (K)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!canNext}
              className="px-2 py-1.5 text-ink-muted hover:bg-mist border-l border-paper-line disabled:opacity-35"
              title="Next (J)"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="inline-flex p-0.5 rounded-full bg-mist/80 border border-paper-line">
            <button
              type="button"
              onClick={() => onViewMode('list')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                viewMode === 'list' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <List size={12} /> List
            </button>
            <button
              type="button"
              onClick={() => onViewMode('board')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                viewMode === 'board' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <LayoutGrid size={12} /> Board
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold bg-white border border-paper-line text-ink-muted">
          <Trophy size={11} className="text-cedar" />
          Week <b className="text-ink tabular-nums">{insights.appliedThisWeek}</b>
        </span>
        <button
          type="button"
          onClick={onFollowUps}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold border ${
            followUps > 0
              ? 'bg-amber-50 border-amber-200 text-amber-950'
              : 'bg-white border-paper-line text-ink-muted'
          }`}
        >
          <CalendarClock size={11} />
          Follow-ups <b className="tabular-nums">{followUps}</b>
        </button>
        <button
          type="button"
          onClick={onHighInterest}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold bg-white border border-paper-line text-ink-muted hover:border-cedar/30"
        >
          <Flame size={11} className="text-cedar" />
          Hot <b className="text-ink tabular-nums">{insights.highInterestReady}</b>
        </button>
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold bg-white border border-paper-line text-ink-muted">
          <Sparkles size={11} className="text-cedar" />
          Interviews <b className="text-ink tabular-nums">{insights.interviews}</b>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onOpenAnswers}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold bg-white border border-paper-line text-ink-muted hover:border-cedar/30"
        >
          <Library size={11} /> Answers
        </button>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold bg-white border border-paper-line text-ink-muted hover:border-cedar/30"
        >
          <Download size={11} /> CSV
        </button>
      </div>
    </div>
  );
}
