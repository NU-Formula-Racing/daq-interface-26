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

  // Track wall-clock elapsed time since the current session started so the
  // bottom timer reads real session duration. Reset on session id change.
  const sessionStartRef = useRef<number | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (status.session_id) {
      sessionStartRef.current = Date.now();
      setElapsedSecs(0);
    } else {
      sessionStartRef.current = null;
      setElapsedSecs(0);
    }
  }, [status.session_id]);

  useEffect(() => {
    if (!status.session_id) return;
    const id = setInterval(() => {
      if (sessionStartRef.current == null) return;
      setElapsedSecs((Date.now() - sessionStartRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [status.session_id]);

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
