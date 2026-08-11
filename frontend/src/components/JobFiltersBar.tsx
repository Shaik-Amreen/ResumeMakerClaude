import { Filter, X } from 'lucide-react';
import type { JobFilters } from '../utils/jobFilters';
import { DEFAULT_FILTERS, STATUS_OPTIONS } from '../utils/jobFilters';

interface Props {
  filters: JobFilters;
  onChange: (next: JobFilters) => void;
  total: number;
  visible: number;
}

const inputClass =
  'w-full rounded-full bg-white/90 border border-paper-line px-3 py-1.5 text-[11px] text-ink shadow-soft focus:outline-none focus:border-cedar focus:shadow-ring transition-all duration-200 font-medium';

export function JobFiltersBar({ filters, onChange, total, visible }: Props) {
  const set = (patch: Partial<JobFilters>) => onChange({ ...filters, ...patch });

  const activeCount = [
    filters.search,
    filters.source !== 'all',
    filters.status !== 'all' && filters.status !== 'action_queue',
    filters.priority !== 'all',
    filters.jobType !== 'all',
    filters.hasApplicants !== 'all',
    filters.hasPosted !== 'all',
    filters.sort !== 'action',
  ].filter(Boolean).length;

  return (
    <div className="p-3 border-b border-paper-line/80 bg-gradient-to-b from-cedar-soft/40 to-transparent shrink-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold tracking-tight text-ink font-display">
          <Filter size={12} className="text-cedar" />
          Filters
        </div>
        <span className="text-[10px] font-semibold text-ink-muted bg-white/80 px-2 py-0.5 rounded-full border border-paper-line">
          {visible}/{total}
          {activeCount > 0 ? ` · ${activeCount}` : ''}
        </span>
      </div>

      <input
        type="search"
        placeholder="Search title, company…"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        className={inputClass}
      />

      <div className="grid grid-cols-2 gap-1.5">
        <select value={filters.source} onChange={(e) => set({ source: e.target.value })} className={inputClass}>
          <option value="all">All platforms</option>
          <option value="company_portal">FAANG / company</option>
          <option value="github">GitHub list</option>
          <option value="simplify">Simplify</option>
          <option value="scoutify">Scoutify</option>
          <option value="jobright">Jobright</option>
          <option value="linkedin">LinkedIn</option>
          <option value="indeed">Indeed</option>
          <option value="career_portal">Google</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
          <option value="other">Other</option>
        </select>

        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as JobFilters['sort'] })} className={inputClass}>
          <option value="action">Sort: Action first</option>
          <option value="priority">Sort: FAANG first</option>
          <option value="newest">Sort: Newest added</option>
          <option value="oldest">Sort: Oldest added</option>
          <option value="posted_newest">Sort: Posted newest</option>
          <option value="posted_oldest">Sort: Posted oldest</option>
          <option value="applicants_low">Sort: Fewest applicants</option>
          <option value="applicants_high">Sort: Most applicants</option>
          <option value="company">Sort: Company A–Z</option>
          <option value="title">Sort: Title A–Z</option>
        </select>

        <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className={inputClass}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select value={filters.priority} onChange={(e) => set({ priority: e.target.value })} className={inputClass}>
          <option value="all">All priorities</option>
          <option value="faang">FAANG / MANGO only</option>
          <option value="standard">Standard only</option>
        </select>

        <select value={filters.jobType} onChange={(e) => set({ jobType: e.target.value })} className={inputClass}>
          <option value="fulltime">Full-time</option>
          <option value="all">All types</option>
        </select>

        <select
          value={filters.hasApplicants}
          onChange={(e) => set({ hasApplicants: e.target.value })}
          className={inputClass}
        >
          <option value="all">Applicants: any</option>
          <option value="yes">Has applicant count</option>
          <option value="no">Missing applicant count</option>
        </select>

        <select value={filters.hasPosted} onChange={(e) => set({ hasPosted: e.target.value })} className={inputClass}>
          <option value="all">Posted: any</option>
          <option value="yes">Has posted date</option>
          <option value="no">Missing posted date</option>
        </select>
      </div>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_FILTERS })}
          className="text-[11px] font-semibold text-cedar hover:text-cedar-ink inline-flex items-center gap-1 transition-colors duration-300 ease-apple"
        >
          <X size={12} /> Clear filters
        </button>
      )}
    </div>
  );
}
