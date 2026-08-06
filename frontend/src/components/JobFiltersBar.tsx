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
  'w-full rounded-xl bg-white border border-slate-200/90 px-3 py-1.5 text-xs text-slate-800 shadow-2xs focus:outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition-all font-medium';

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
    <div className="p-3.5 border-b border-slate-200/80 bg-gradient-to-r from-slate-50/90 via-teal-50/40 to-sky-50/40 shrink-0 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
          <Filter size={14} className="text-teal-600" />
          Filter Jobs
        </div>
        <span className="text-[10px] font-semibold text-slate-500 bg-white/80 px-2 py-0.5 rounded-full border border-slate-200/80 shadow-2xs">
          Showing {visible} of {total}
          {activeCount > 0 ? ` · ${activeCount} active` : ''}
        </span>
      </div>

      <div className="relative">
        <input
          type="search"
          placeholder="Search title, company, JD keywords…"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
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
          className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 inline-flex items-center gap-1 pt-1 transition-colors"
        >
          <X size={12} /> Clear all filters ({activeCount})
        </button>
      )}
    </div>
  );
}
