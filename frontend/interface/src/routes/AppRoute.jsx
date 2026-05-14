import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  DockDirection,
  FramesProvider,
  SignalsProvider,
} from '@nfr/widgets';
import { useSupabaseCatalog } from '@/adapters/useSupabaseCatalog';
import { useSessionList } from '@/adapters/useSessionList';
import { useSupabaseFrames } from '@/adapters/useSupabaseFrames';
import { useSupabaseLiveFrames } from '@/adapters/useSupabaseLiveFrames';

// DockDirection uses its own storage key internally ('nfr-dock-layout-v2').
// We read from the same key to know which signals are currently in the dock.
const DOCK_STORAGE_KEY = 'nfr-dock-layout-v2';

// Widget layouts persist signals as either numeric IDs or string names
// (e.g. "Battery_Voltage" or "Rear Inverter/RPM"). Resolve through the
// catalog so we always send numeric IDs to get_signals_window.
function readDockSignalIds(catalog) {
  if (!catalog) return [];
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return [];
    const widgets = JSON.parse(raw);
    const ids = new Set();
    for (const w of widgets ?? []) {
      for (const sig of w.signals ?? []) {
        const resolved = catalog.resolve(sig);
        if (resolved) ids.add(resolved.id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  } catch { return []; }
}

export default function AppRoute() {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const mode = search.get('mode') === 'live' ? 'live' : 'replay';
  const sessionId = search.get('session');
  const [t, setT] = useState(1);

  const setMode = (next) => setSearch((p) => {
    p.set('mode', next);
    if (next === 'live') p.delete('session');
    return p;
  });

  const catalog = useSupabaseCatalog();
  const { sessions } = useSessionList(50);

  // Replay-mode session selection (only meaningful when mode === 'replay').
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0] ?? null;
  useEffect(() => {
    if (mode === 'replay' && !sessionId && session?.id) {
      setSearch((p) => { p.set('session', session.id); return p; }, { replace: true });
    }
  }, [mode, sessionId, session, setSearch]);

  // Track which signals the dock currently has (from localStorage).
  const [signalIds, setSignalIds] = useState([]);
  useEffect(() => {
    if (!catalog) return;
    setSignalIds(readDockSignalIds(catalog));
    const interval = setInterval(() => {
      const next = readDockSignalIds(catalog);
      setSignalIds((prev) => {
        const same = next.length === prev.length && next.every((v, i) => v === prev[i]);
        return same ? prev : next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [catalog]);

  // Both adapters mount on every render but only the active one hits Supabase.
  // Replay only triggers when given a session + signals; live always streams.
  const replay = useSupabaseFrames({
    sessionId: mode === 'replay' ? (session?.id ?? null) : null,
    signalIds: mode === 'replay' ? signalIds : [],
    start: mode === 'replay' ? (session?.started_at ?? null) : null,
    end: mode === 'replay' ? (session?.ended_at ?? null) : null,
  });
  const live = useSupabaseLiveFrames(mode === 'live');

  const { store, status } = mode === 'live' ? live : replay;

  const sessionSlot = mode === 'replay' ? (
    <select
      value={session?.id ?? ''}
      onChange={(e) => setSearch((p) => { p.set('session', e.target.value); return p; })}
      style={{
        background: '#2b2d30',
        color: '#dfe1e5',
        border: '1px solid rgba(255,255,255,0.09)',
        padding: '3px 8px',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
      }}
    >
      {sessions.map((s) => (
        <option key={s.id} value={s.id}>
          {s.date} · {s.duration_secs}s
        </option>
      ))}
    </select>
  ) : (
    <span style={{
      padding: '3px 8px',
      fontSize: 10,
      letterSpacing: 1,
      color:
        status.kind === 'error' ? '#e06c6c' :
        status.kind === 'ready' ? '#7ec98f' :
        '#9da0a8',
      border: '1px solid rgba(255,255,255,0.09)',
      fontFamily: '"JetBrains Mono", monospace',
    }}>
      {status.kind === 'error' ? `ERR: ${String(status.message).slice(0, 40)}` : `LIVE · ${status.kind.toUpperCase()}`}
    </span>
  );

  return (
    <SignalsProvider catalog={catalog}>
      <FramesProvider store={store}>
        <div style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#1e1f22',
          color: '#dfe1e5',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          <DockDirection
            t={mode === 'live' ? 1 : t}
            onT={setT}
            mode={mode}
            onMode={setMode}
            durationSecs={mode === 'live' ? 0 : (session?.duration_secs ?? 0)}
            density="comfortable"
            graphStyle="line"
            frames={store}
            navigate={navigate}
            sessionSlot={sessionSlot}
            exportHref={null}
            allowDataImport={false}
          />
        </div>
      </FramesProvider>
    </SignalsProvider>
  );
}
