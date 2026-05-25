import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '@nfr/widgets';
import { SessionPicker } from '../components/SessionPicker.tsx';
import { useReplayFrames } from '../hooks/useReplayFrames.ts';
import { useSessionSignalIds } from '../hooks/useSessionSignalIds.ts';
import type { SessionDetail } from '../api/types.ts';
import { apiGet } from '../api/client.ts';

export default function Replay() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Fetch session metadata to get bounds.
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<SessionDetail>(`/api/sessions/${id}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setDetailErr(String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  // Dock-level zoom (most-recent-zoom wins).
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [t, setT] = useState(1);

  const sessionStart = detail?.started_at ?? null;
  const sessionEnd = detail?.ended_at ?? null;
  const durationSecs = useMemo(() => {
    if (!sessionStart || !sessionEnd) return 0;
    return Math.max(0, (Date.parse(sessionEnd) - Date.parse(sessionStart)) / 1000);
  }, [sessionStart, sessionEnd]);

  const visStart = useMemo(() => {
    if (!sessionStart || !sessionEnd) return null;
    if (!zoom) return sessionStart;
    return new Date(Date.parse(sessionStart) + zoom[0] * durationSecs * 1000).toISOString();
  }, [sessionStart, sessionEnd, zoom, durationSecs]);
  const visEnd = useMemo(() => {
    if (!sessionStart || !sessionEnd) return null;
    if (!zoom) return sessionEnd;
    return new Date(Date.parse(sessionStart) + zoom[1] * durationSecs * 1000).toISOString();
  }, [sessionStart, sessionEnd, zoom, durationSecs]);

  // Track which signals the dock currently displays. The dock persists its
  // widget layout in localStorage; we poll for changes the same way the
  // website does (no callback API exists yet).
  const [signalIds, setSignalIds] = useState<number[]>([]);
  const lastIdsRef = useRef<string>('');
  useEffect(() => {
    const tick = () => {
      try {
        const raw = localStorage.getItem('nfr-dock-layout-v2');
        if (!raw) {
          if (lastIdsRef.current !== '') {
            lastIdsRef.current = '';
            setSignalIds([]);
          }
          return;
        }
        const widgets = JSON.parse(raw);
        const ids = new Set<number>();
        for (const w of widgets ?? []) {
          for (const sig of w.signals ?? []) {
            if (typeof sig === 'number') ids.add(sig);
          }
        }
        const sorted = [...ids].sort((a, b) => a - b);
        const key = sorted.join(',');
        if (key !== lastIdsRef.current) {
          lastIdsRef.current = key;
          setSignalIds(sorted);
        }
      } catch {
        /* ignore */
      }
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, []);

  const { store, status: _status } = useReplayFrames({
    sessionId: id ?? null,
    signalIds,
    start: visStart,
    end: visEnd,
  });

  const { ids: availableSignalIds, status: idsStatus } = useSessionSignalIds(id ?? null);

  if (detailErr) {
    return <div className="p-6 font-mono text-xs text-red-400">ERROR: {detailErr}</div>;
  }
  if (!detail) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }

  return (
    <SignalsProvider>
      <div className="h-full flex flex-col">
        <DockDirection
          t={t}
          onT={setT}
          mode="replay"
          onMode={(m) => { if (m === 'live') navigate('/'); }}
          durationSecs={durationSecs}
          density="compact"
          graphStyle="line"
          frames={store}
          exportHref={id ? `/api/sessions/${id}/export.csv` : null}
          navigate={navigate}
          sessionSlot={<SessionPicker />}
          availableSignalIds={idsStatus === 'ready' ? availableSignalIds : null}
          onZoom={(z) => setZoom(z)}
        />
      </div>
    </SignalsProvider>
  );
}
