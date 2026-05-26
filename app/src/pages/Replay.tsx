import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SignalsProvider, useCatalog } from '../components/SignalsProvider.tsx';
import { DockDirection } from '@nfr/widgets';
import { SessionPicker } from '../components/SessionPicker.tsx';
import { useReplayFrames } from '../hooks/useReplayFrames.ts';
import { useSessionSignalIds } from '../hooks/useSessionSignalIds.ts';
import type { SessionDetail } from '../api/types.ts';
import { apiGet } from '../api/client.ts';

export default function Replay() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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

  if (detailErr) {
    return <div className="p-6 font-mono text-xs text-red-400">ERROR: {detailErr}</div>;
  }
  if (!detail || !id) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }

  return (
    <SignalsProvider>
      <ReplayInner id={id} detail={detail} navigate={navigate} />
    </SignalsProvider>
  );
}

interface ReplayInnerProps {
  id: string;
  detail: SessionDetail;
  navigate: (path: string) => void;
}

function ReplayInner({ id, detail, navigate }: ReplayInnerProps) {
  const catalog = useCatalog();

  // Shared-zoom model. visStart/visEnd are absolute timestamps describing the
  // window currently fetched and rendered. Default: the whole session. Each
  // widget renders its buffer 1:1 (zoom={null} downstream); fractions emitted
  // by widget drag are interpreted as fractions of THIS window and composed
  // into a new absolute window for the next refetch.
  const [t, setT] = useState(1);
  const sessionStart = detail.started_at;
  const sessionEnd = detail.ended_at;
  const [visStart, setVisStart] = useState<string | null>(sessionStart);
  const [visEnd, setVisEnd] = useState<string | null>(sessionEnd);
  useEffect(() => {
    setVisStart(sessionStart);
    setVisEnd(sessionEnd);
  }, [sessionStart, sessionEnd]);

  const durationSecs = useMemo(() => {
    if (!visStart || !visEnd) return 0;
    return Math.max(0, (Date.parse(visEnd) - Date.parse(visStart)) / 1000);
  }, [visStart, visEnd]);

  const handleZoom = (z: [number, number] | null) => {
    if (z === null) {
      setVisStart(sessionStart);
      setVisEnd(sessionEnd);
      return;
    }
    if (!visStart || !visEnd) return;
    const startMs = Date.parse(visStart);
    const endMs = Date.parse(visEnd);
    const span = endMs - startMs;
    setVisStart(new Date(startMs + z[0] * span).toISOString());
    setVisEnd(new Date(startMs + z[1] * span).toISOString());
  };

  // Resolve widget-layout signal entries (which may be names OR ids) through the
  // catalog and extract numeric ids. Polls localStorage because the dock has no
  // callback API for layout changes.
  const [signalIds, setSignalIds] = useState<number[]>([]);
  const lastIdsRef = useRef<string>('');
  useEffect(() => {
    if (!catalog) return;
    const tick = () => {
      try {
        const raw = localStorage.getItem('nfr-dock-layout-v2');
        const widgets = raw ? JSON.parse(raw) : [];
        const ids = new Set<number>();
        for (const w of widgets ?? []) {
          for (const sig of w.signals ?? []) {
            const resolved = catalog.resolve(sig);
            if (resolved) ids.add(resolved.id);
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
  }, [catalog]);

  const { store } = useReplayFrames({
    sessionId: id,
    signalIds,
    start: visStart,
    end: visEnd,
  });

  const { ids: availableSignalIds, status: idsStatus } = useSessionSignalIds(id);

  return (
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
        exportHref={`/api/sessions/${id}/export.csv`}
        navigate={navigate}
        sessionSlot={<SessionPicker />}
        availableSignalIds={idsStatus === 'ready' ? availableSignalIds : null}
        onZoom={handleZoom}
        zoomActive={visStart !== sessionStart || visEnd !== sessionEnd}
        sessionStartTs={sessionStart}
      />
    </div>
  );
}
