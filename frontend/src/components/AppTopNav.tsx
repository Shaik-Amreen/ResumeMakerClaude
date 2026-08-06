import { NavLink } from 'react-router-dom';
import { Briefcase, FileCode2, Sparkles, Cpu } from 'lucide-react';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold tracking-wide border transition-all duration-200 ${
    isActive
      ? 'bg-gradient-to-r from-teal-600 to-teal-700 text-white border-teal-600 shadow-md shadow-teal-500/20'
      : 'bg-white/80 text-slate-600 border-slate-200/80 hover:bg-teal-50 hover:text-teal-800 hover:border-teal-200/80'
  }`;

/** Top mode switcher — Job Tracker vs Paste→LaTeX studio. */
export function AppTopNav() {
  return (
    <nav className="relative z-20 shrink-0 border-b border-slate-200/80 bg-white/85 backdrop-blur-md shadow-xs">
      <div className="max-w-[1600px] w-full mx-auto px-4 md:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-teal-600 via-sky-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-teal-500/20">
            <Cpu size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[11px] uppercase tracking-widest font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-600 to-sky-600">
                Karthik · ResumeMaker AI
              </p>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                <Sparkles size={10} /> v2.0
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">Auto-Tailoring &amp; Multi-Source Pipeline</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <NavLink to="/" end className={linkClass}>
            <Briefcase size={15} />
            Job Tracker &amp; Pipeline
          </NavLink>
          <NavLink to="/latex-studio" className={linkClass}>
            <FileCode2 size={15} />
            Paste → LaTeX Studio
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
