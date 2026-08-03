import { NavLink } from 'react-router-dom';
import { Briefcase, FileCode2 } from 'lucide-react';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
    isActive
      ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
      : 'bg-white text-ink-muted border-slate-200 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-200'
  }`;

/** Top mode switcher — Job Tracker vs Paste→LaTeX studio. */
export function AppTopNav() {
  return (
    <nav className="relative z-20 shrink-0 border-b border-slate-200/80 bg-white/80 backdrop-blur-md">
      <div className="max-w-[1600px] w-full mx-auto px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-primary-500 font-medium">
            Amreen · ResumeMaker
          </p>
          <p className="text-sm text-ink-muted">Choose a workspace</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavLink to="/" end className={linkClass}>
            <Briefcase size={16} />
            Job Tracker
          </NavLink>
          <NavLink to="/latex-studio" className={linkClass}>
            <FileCode2 size={16} />
            Paste → LaTeX
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
