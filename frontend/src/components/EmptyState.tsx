import { FilterX, Search, Sparkles } from 'lucide-react';

interface Props {
  hasTotalJobs: boolean;
  onClearFilters: () => void;
  onRunPipeline: () => void;
}

export function EmptyState({ hasTotalJobs, onClearFilters, onRunPipeline }: Props) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div className="relative">
        <div className="h-16 w-16 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shadow-inner">
          {hasTotalJobs ? <FilterX size={28} /> : <Search size={28} />}
        </div>
        <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-amber-400 text-white flex items-center justify-center animate-bounce shadow-xs">
          <Sparkles size={12} />
        </div>
      </div>

      <div className="space-y-1 max-w-xs">
        <h4 className="text-sm font-bold text-slate-800">
          {hasTotalJobs ? 'No matching jobs found' : 'No jobs in database'}
        </h4>
        <p className="text-xs text-slate-500 leading-relaxed">
          {hasTotalJobs
            ? 'Try clearing search or relaxing status & platform filters.'
            : 'Start by triggering the FAANG or Full Pipeline scraper.'}
        </p>
      </div>

      {hasTotalJobs ? (
        <button
          type="button"
          onClick={onClearFilters}
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 transition-colors shadow-2xs"
        >
          Clear All Filters
        </button>
      ) : (
        <button
          type="button"
          onClick={onRunPipeline}
          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors shadow-sm"
        >
          Run Full Pipeline
        </button>
      )}
    </div>
  );
}
