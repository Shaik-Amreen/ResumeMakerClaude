import { FilterX, Search, Send } from 'lucide-react';

interface Props {
  hasTotalJobs: boolean;
  onClearFilters: () => void;
  onRunPipeline: () => void;
}

export function EmptyState({ hasTotalJobs, onClearFilters, onRunPipeline }: Props) {
  return (
    <div className="flex flex-col items-center justify-center p-10 text-center space-y-4 animate-fade-up">
      <div className="h-[4.5rem] w-[4.5rem] rounded-[1.35rem] bg-cedar-soft/80 border border-cedar/15 flex items-center justify-center text-cedar shadow-soft transition-transform duration-500 ease-apple hover:scale-[1.03]">
        {hasTotalJobs ? <FilterX size={26} /> : <Search size={26} />}
      </div>

      <div className="space-y-1.5 max-w-[15rem]">
        <h4 className="text-sm font-bold font-display text-ink tracking-tight">
          {hasTotalJobs ? 'Queue clear' : 'No jobs yet'}
        </h4>
        <p className="text-xs text-ink-muted leading-relaxed">
          {hasTotalJobs
            ? 'Nothing needs you right now. Show All, or generate resumes for scraped roles.'
            : 'Scrape FAANG or ATS boards, then generate resumes and apply on career pages.'}
        </p>
      </div>

      {hasTotalJobs ? (
        <button type="button" onClick={onClearFilters} className="btn-secondary">
          Show all jobs
        </button>
      ) : (
        <button
          type="button"
          onClick={onRunPipeline}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <Send size={13} /> Run Full Pipeline
        </button>
      )}
    </div>
  );
}
