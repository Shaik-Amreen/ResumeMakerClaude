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
  'w-full rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-ink shadow-sm focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-100';

export function JobFiltersBar({ filters, onChange, total, visible }: Props) {
  const set = (patch: Partial<JobFilters>) => onChange({ ...filters, ...patch });

  const activeCount = [
    filters.search,
    filters.source !== 'all',
    filters.status !== 'all',
    filters.priority !== 'all',
    filters.jobType !== 'all',
    filters.hasApplicants !== 'all',
    filters.hasPosted !== 'all',
    filters.sort !== 'priority',
  ].filter(Boolean).length;

  return (
    <div className="p-3 border-b border-slate-200 bg-gradient-to-r from-teal-50/80 to-sky-50/60 shrink-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Filter size={14} className="text-primary-500" />
          Jobs
        </div>
        <span className="text-[10px] text-ink-faint">
          {visible}/{total}
          {activeCount > 0 ? ` · ${activeCount} filter(s)` : ''}
        </span>
      </div>

      <input
        type="search"
        placeholder="Search title, company, JD…"
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
          <option value="jobright">Jobright</option>
          <option value="linkedin">LinkedIn</option>
          <option value="indeed">Indeed</option>
          <option value="career_portal">Google</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
          <option value="other">Other</option>
        </select>

        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as JobFilters['sort'] })} className={inputClass}>
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
          className="text-[10px] text-primary-500 hover:text-primary-400 inline-flex items-center gap-1"
        >
          <X size={12} /> Clear filters
        </button>
      )}
    </div>
  );
}
