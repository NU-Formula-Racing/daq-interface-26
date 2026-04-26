import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from './api/client.ts';
import { useLiveStatus } from './hooks/useLiveStatus.ts';
import { NFRMark } from './components/widgets.tsx';

const NAV: Array<[string, string]> = [
  ['/', 'LIVE'],
  ['/sessions', 'SESSIONS'],
  ['/settings', 'SETTINGS'],
];

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const status = useLiveStatus();
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

  const liveDot =
    status.basestation === 'connected' ? '#7ec98f' : '#e06c6c';
  const liveText =
    status.basestation === 'connected'
      ? status.session_id
        ? `RECORDING · ${status.session_id.slice(0, 8)}`
        : 'CONNECTED'
      : 'DISCONNECTED';

  return (
    <div className="h-full flex flex-col">
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '8px 16px',
          background: '#1e1f22',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11, flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NFRMark />
          <span style={{ color: '#dfe1e5', letterSpacing: 1.2, fontWeight: 600 }}>
            NFR · DAQ
          </span>
        </div>

        <nav style={{ display: 'flex', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
          {NAV.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              style={({ isActive }) => ({
                padding: '4px 12px',
                background: isActive ? 'rgba(167,139,250,0.18)' : 'transparent',
                color: isActive ? '#dfe1e5' : 'rgba(255,255,255,0.5)',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10, letterSpacing: 1, cursor: 'pointer',
                textTransform: 'uppercase', textDecoration: 'none',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.6)' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: liveDot,
            boxShadow: status.basestation === 'connected' ? `0 0 6px ${liveDot}` : 'none',
          }} />
          <span style={{ fontSize: 10, letterSpacing: 1 }}>{liveText}</span>
          {status.port && status.basestation === 'connected' && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>
              {status.port.length > 50 ? '…' + status.port.slice(-47) : status.port}
            </span>
          )}
        </span>

        <span style={{ flex: 1 }} />

        {dbcStatus && (
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>{dbcStatus}</span>
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
          style={{
            padding: '4px 10px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.6)',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10, letterSpacing: 1, cursor: 'pointer',
            textTransform: 'uppercase',
          }}
          title="Upload a new DBC CSV"
        >
          ↑ IMPORT DBC
        </button>
      </header>

      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  );
}
