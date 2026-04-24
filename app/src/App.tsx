import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from './api/client.ts';

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname === '/setup') return;
    apiGet<{ pg: string }>('/api/setup/status')
      .then((s) => {
        if (s.pg !== 'ok') nav('/setup', { replace: true });
      })
      .catch(() => {
        nav('/setup', { replace: true });
      });
  }, [loc.pathname, nav]);

  return (
    <div className="h-full flex flex-col">
      <header className="h-10 flex items-center gap-4 px-4 border-b border-[color:var(--color-border)]">
        <span className="font-mono text-xs tracking-widest text-[color:var(--color-text-mute)]">
          NFR · LOCAL
        </span>
        <nav className="flex gap-2 text-xs font-mono">
          {[
            ['/', 'LIVE'],
            ['/sessions', 'SESSIONS'],
            ['/settings', 'SETTINGS'],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-2 py-1 rounded-sm ${
                  isActive
                    ? 'bg-[color:var(--color-accent)]/30 text-[color:var(--color-text)]'
                    : 'text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
