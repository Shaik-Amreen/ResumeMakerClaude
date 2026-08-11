import { NavLink } from 'react-router-dom';
import { Briefcase, FileCode2, Leaf } from 'lucide-react';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[13px] font-semibold transition-[transform,background-color,color] duration-press ease-out active:scale-[0.97] ${
    isActive
      ? 'bg-ink text-white shadow-soft'
      : 'text-ink-muted hover:text-ink hover:bg-white/55'
  }`;

/** Top mode switcher — translucent floating chrome. */
export function AppTopNav() {
  return (
    <nav className="relative z-20 shrink-0 sticky top-0 toolbar border-b border-white/40">
      <div className="max-w-[1600px] w-full mx-auto px-4 md:px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-[0.95rem] bg-gradient-to-br from-cedar via-cedar-hover to-cedar-ink flex items-center justify-center text-white shadow-soft transition-transform duration-settle ease-apple active:scale-[0.97]">
            <Leaf size={17} strokeWidth={2.25} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="display-title text-[15px] text-ink">ResumeMaker</p>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cedar-soft/90 text-cedar-ink border border-cedar/15">
                Career apply
              </span>
            </div>
            <p className="text-[11px] text-ink-faint font-medium leading-snug">
              Scrape · tailor · apply
            </p>
          </div>
        </div>

        <div className="inline-flex p-0.5 rounded-full bg-black/[0.04] border border-white/50">
          <NavLink to="/" end className={linkClass}>
            <Briefcase size={14} />
            Job Tracker
          </NavLink>
          <NavLink to="/latex-studio" className={linkClass}>
            <FileCode2 size={14} />
            LaTeX Studio
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
