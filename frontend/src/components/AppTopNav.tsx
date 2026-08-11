import { NavLink } from 'react-router-dom';

export function AppTopNav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-teal-100 text-teal-900'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <header className="shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur-md z-20">
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-12 flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-slate-800 tracking-tight">
          Amreen · Job Command Center
        </p>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            Jobs
          </NavLink>
          <NavLink to="/latex-studio" className={linkClass}>
            LaTeX Studio
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
