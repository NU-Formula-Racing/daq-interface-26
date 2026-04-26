import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from './api/client.ts';

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dbcStatus, setDbcStatus] = useState<string>('');

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

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setDbcStatus('Uploading…');
    try {
      const text = await f.text();
      const res = await fetch('/api/dbc/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      if (!res.ok) {
        const errBody = await res.text();
        setDbcStatus(`Failed: ${errBody.slice(0, 80)}`);
        return;
      }
      setDbcStatus('DBC applied. Reloading…');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setDbcStatus(`Error: ${String(err)}`);
    }
  };

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
        <div className="ml-auto flex items-center gap-3">
          {dbcStatus && (
            <span className="font-mono text-[10px] text-[color:var(--color-text-mute)]">{dbcStatus}</span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={onPickFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-2 py-1 text-xs font-mono tracking-widest text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)] border border-[color:var(--color-border)]"
            title="Upload a new DBC CSV"
          >
            📄 IMPORT DBC
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
