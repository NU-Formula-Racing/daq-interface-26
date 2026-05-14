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
  const sessionId = search.get('session');
  const navigate = useNavigate();

  const catalog = useSupabaseCatalog();
  const { sessions } = useSessionList(50);
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0] ?? null;

  // Default URL to first session if no param.
  useEffect(() => {
    if (!sessionId && session?.id) {
      setSearch((p) => { p.set('session', session.id); return p; }, { replace: true });
    }
  }, [sessionId, session, setSearch]);

  // Track which signals the dock currently has (from localStorage).
  // Re-poll periodically since DockDirection writes localStorage on every layout change.
  // Depends on catalog because it resolves signal-name strings → numeric IDs.
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

  const { store, status } = useSupabaseFrames({
    sessionId: session?.id ?? null,
    signalIds,
    start: session?.started_at ?? null,
    end: session?.ended_at ?? null,
  });

  const statusBadge = (
    <span style={{
      padding: '2px 8px',
      fontSize: 9,
      letterSpacing: 1,
      fontFamily: '"JetBrains Mono", monospace',
      border: '1px solid rgba(255,255,255,0.09)',
      color:
        status.kind === 'error' ? '#e06c6c' :
        status.kind === 'ready' ? '#7ec98f' :
        '#9da0a8',
    }}>
      {status.kind === 'error' ? `ERR: ${String(status.message).slice(0, 40)}` : status.kind.toUpperCase()}
    </span>
  );

  const sessionSlot = (
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
            t={1}
            onT={() => {}}
            mode="replay"
            onMode={() => {}}
            durationSecs={session?.duration_secs ?? 0}
            density="comfortable"
            graphStyle="line"
            frames={store}
            navigate={navigate}
            sessionSlot={sessionSlot}
            exportHref={null}
          />
        </div>
      </FramesProvider>
    </SignalsProvider>
  );
}
