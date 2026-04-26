import { useEffect, useRef, useState } from 'react';
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';
import { useLiveFrames } from '../hooks/useLiveFrames.ts';
import { useLiveStatus } from '../hooks/useLiveStatus.ts';

const LIVE_THRESHOLD = 0.995; // Anything ≥ this counts as "snap to live"

export default function Live() {
  const status = useLiveStatus();
  const frames = useLiveFrames();
  const [t, setT] = useState(1);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const rafRef = useRef<number | null>(null);

  // Reset the frames buffer (and its first/latest timestamps) every time a
  // new session starts so the bottom timer reflects this session only.
  useEffect(() => {
    frames.reset();
  }, [status.session_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duration = (latest frame ts) − (first frame ts). Updates as frames flow.
  const first = frames.firstTs();
  const last = frames.latestTs();
  const elapsedSecs = first && last
    ? Math.max(0, (new Date(last).getTime() - new Date(first).getTime()) / 1000)
    : 0;

  useEffect(() => {
    if (mode !== 'live') return;
    const tick = () => {
      setT((cur) => (cur === 1 ? cur : 1));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [mode]);

  const handleT = (next: number) => {
    setT(next);
    if (next >= LIVE_THRESHOLD) {
      if (mode !== 'live') setMode('live');
    } else {
      if (mode !== 'replay') setMode('replay');
    }
  };

  return (
    <SignalsProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <DockDirection
          t={t}
          onT={handleT}
          mode={mode}
          onMode={setMode}
          durationSecs={elapsedSecs}
          density="compact"
          graphStyle="line"
          frames={frames}
          exportHref={status.session_id ? `/api/sessions/${status.session_id}/export.csv` : null}
        />
      </div>
    </SignalsProvider>
  );
}
