import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';
import { useOverview } from '../hooks/useOverview.ts';
import { FramesStore, type FrameRow } from '../hooks/useLiveFrames.ts';
import type { OverviewRow } from '../api/types.ts';

function makeReplayStore(rows: OverviewRow[], t: number): FramesStore {
  // Build a real FramesStore with a full push, then override latest/series based on t.
  // The live FramesStore shape uses latest() + series(); for replay we provide
  // a read-only façade that returns slices of the preloaded rows up to `t`.
  const bySignal = new Map<number, FrameRow[]>();
  for (const r of rows) {
    const frame: FrameRow = {
      ts: r.bucket,
      signal_id: r.signal_id,
      value: r.avg_value,
    };
    let arr = bySignal.get(r.signal_id);
    if (!arr) {
      arr = [];
      bySignal.set(r.signal_id, arr);
    }
    arr.push(frame);
  }
  for (const arr of bySignal.values()) {
    arr.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  // Return an object that duck-types to FramesStore shape but ignores push/subscribe.
  const cutoff = (arr: FrameRow[]) =>
    Math.max(0, Math.min(arr.length - 1, Math.floor(t * arr.length)));

  return {
    push: () => {},
    latest: (id: number) => {
      const arr = bySignal.get(id);
      if (!arr || arr.length === 0) return null;
      return arr[cutoff(arr)] ?? null;
    },
    series: (id: number) => {
      const arr = bySignal.get(id);
      if (!arr || arr.length === 0) return [];
      return arr.slice(0, cutoff(arr) + 1);
    },
    getVersion: () => 0,
    subscribe: () => () => {},
  } as unknown as FramesStore;
}

export default function Replay() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { rows, loading, error } = useOverview(id!, 1);
  const [t, setT] = useState(1);

  const store = useMemo(() => makeReplayStore(rows, t), [rows, t]);

  // Total session duration in seconds — bucket timestamps span the full window.
  const durationSecs = useMemo(() => {
    if (rows.length < 2) return 0;
    const first = new Date(rows[0].bucket).getTime();
    const last = new Date(rows[rows.length - 1].bucket).getTime();
    return Math.max(0, (last - first) / 1000);
  }, [rows]);

  if (loading) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }
  if (error) {
    return <div className="p-6 font-mono text-xs text-red-400">ERROR: {error}</div>;
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
        />
      </div>
    </SignalsProvider>
  );
}
