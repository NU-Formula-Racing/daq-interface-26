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
import { useSupabaseLiveReplay } from '@/adapters/useSupabaseLiveReplay';
import { useSessionSignalIds } from '@/adapters/useSessionSignalIds';
import { useLiveSessionSignalIds } from '@/adapters/useLiveSessionSignalIds';
import { useLiveSessions } from '@/adapters/useLiveSessions';
import SessionPicker from '@/components/SessionPicker';

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
  const { sessions } = useSessionList(200);
  const { sessions: liveSessions } = useLiveSessions();

  // Replay-mode selection: the picker may point at either an SD session
  // (sessions) or a live session (liveSessions). Resolve to whichever
  // matches the URL ?session= id, defaulting to the first SD session.
  const sdSession = sessions.find((s) => s.id === sessionId) ?? null;
  const liveSession = liveSessions.find((s) => s.id === sessionId) ?? null;
  const session = sdSession ?? liveSession ?? sessions[0] ?? null;
  const isLiveSession = !!liveSession;

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

  // Available-signal sets for both flavours; pick the right one downstream.
  const sdIds = useSessionSignalIds(
    mode === 'replay' && !isLiveSession ? (session?.id ?? null) : null,
  );
  const liveIds = useLiveSessionSignalIds(
    mode === 'replay' && isLiveSession ? (session?.id ?? null) : null,
  );
  const sessionSignalIds = isLiveSession ? liveIds.ids : sdIds.ids;
  const idsStatus = isLiveSession ? liveIds.status : sdIds.status;

  // Three adapters; only one is active per render based on `mode` and
  // whether the currently-selected replay session is live or SD.
  //  - useSupabaseFrames     → SD replay (sd_readings, get_signals_window)
  //  - useSupabaseLiveReplay → live replay (live_readings, get_live_signals_window)
  //  - useSupabaseLiveFrames → live tick mode (Realtime subscription)
  // For live sessions still in progress, end is null; fall back to "now"
  // so the windowed fetch covers everything received so far.
  const replayEnd = session?.ended_at ?? (isLiveSession ? new Date().toISOString() : null);
  const sdReplay = useSupabaseFrames({
    sessionId: mode === 'replay' && !isLiveSession ? (session?.id ?? null) : null,
    signalIds: mode === 'replay' && !isLiveSession ? signalIds : [],
    start: mode === 'replay' && !isLiveSession ? (session?.started_at ?? null) : null,
    end: mode === 'replay' && !isLiveSession ? (session?.ended_at ?? null) : null,
  });
  const liveReplay = useSupabaseLiveReplay({
    sessionId: mode === 'replay' && isLiveSession ? (session?.id ?? null) : null,
    signalIds: mode === 'replay' && isLiveSession ? signalIds : [],
    start: mode === 'replay' && isLiveSession ? (session?.started_at ?? null) : null,
    end: mode === 'replay' && isLiveSession ? replayEnd : null,
  });
  const live = useSupabaseLiveFrames(mode === 'live');

  const { store, status } =
    mode === 'live' ? live :
    isLiveSession ? liveReplay :
    sdReplay;

  const sessionSlot = mode === 'replay' ? (
    <SessionPicker
      sessions={sessions}
      liveSessions={liveSessions}
      currentId={session?.id ?? null}
      onPick={(id) => setSearch((p) => {
        if (id) p.set('session', id); else p.delete('session');
        p.delete('date');
        return p;
      })}
    />
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
            durationSecs={
            mode === 'live'
              ? 0
              : isLiveSession
                ? Math.max(0, (Date.parse(replayEnd) - Date.parse(session?.started_at)) / 1000)
                : (session?.duration_secs ?? 0)
          }
            density="comfortable"
            graphStyle="line"
            frames={store}
            navigate={navigate}
            sessionSlot={sessionSlot}
            exportHref={null}
            allowDataImport={false}
            availableSignalIds={mode === 'replay' && idsStatus === 'ready' ? sessionSignalIds : null}
          />
        </div>
      </FramesProvider>
    </SignalsProvider>
  );
}
