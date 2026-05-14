import { useState } from 'react';
import {
  GraphWidget,
  FramesProvider,
  SignalsProvider,
} from '@nfr/widgets';
import { useSupabaseCatalog } from '@/adapters/useSupabaseCatalog';
import { useSessionList } from '@/adapters/useSessionList';
import { useSupabaseFrames } from '@/adapters/useSupabaseFrames';

export default function AppDevRoute() {
  const catalog = useSupabaseCatalog();
  const { sessions, loading: sessionsLoading } = useSessionList(20);
  const [sessionId, setSessionId] = useState(null);

  const active = sessionId ?? sessions[0]?.id ?? null;
  const session = sessions.find((s) => s.id === active);

  // First signal in the catalog (catalog.ALL is from the rich shape).
  const allSignals = catalog?.ALL ?? [];
  const signalIds = allSignals.length > 0 ? [allSignals[0].id] : [];

  const { store, status } = useSupabaseFrames({
    sessionId: active,
    signalIds,
    start: session?.started_at ?? null,
    end: session?.ended_at ?? null,
  });

  return (
    <SignalsProvider catalog={catalog}>
      <FramesProvider store={store}>
        <div style={{
          padding: 16,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          background: '#1e1f22',
          color: '#dfe1e5',
          minHeight: '100vh',
        }}>
          <h1 style={{ fontSize: 14, letterSpacing: 1.5, marginBottom: 12 }}>
            APP-DEV — single-widget smoke test
          </h1>
          <div style={{ marginBottom: 12 }}>
            <label>SESSION:&nbsp;</label>
            <select
              value={active ?? ''}
              onChange={(e) => setSessionId(e.target.value)}
              disabled={sessionsLoading}
              style={{ background: '#2b2d30', color: '#dfe1e5', padding: 4 }}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} · {s.duration_secs}s · {s.signal_count} signals
                </option>
              ))}
            </select>
            <span style={{ marginLeft: 12, color: status.kind === 'error' ? '#e06c6c' : '#9da0a8' }}>
              [{status.kind === 'error' ? `ERR: ${status.message}` : status.kind.toUpperCase()}]
            </span>
          </div>
          <div style={{ marginBottom: 8, color: '#9da0a8' }}>
            Signal: {allSignals[0]?.name ?? '(none)'} ({allSignals[0]?.unit ?? ''})
          </div>
          <div style={{ height: 320, border: '1px solid rgba(255,255,255,0.09)' }}>
            {signalIds.length > 0 && active && session?.ended_at ? (
              <GraphWidget signals={signalIds} t={1} mode="replay" />
            ) : (
              <div style={{ padding: 16 }}>Waiting for catalog + session…</div>
            )}
          </div>
        </div>
      </FramesProvider>
    </SignalsProvider>
  );
}
