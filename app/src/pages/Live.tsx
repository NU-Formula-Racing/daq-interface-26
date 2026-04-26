import { useEffect, useRef, useState } from 'react';
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';
import { useLiveFrames } from '../hooks/useLiveFrames.ts';
import { useLiveStatus } from '../hooks/useLiveStatus.ts';
import type { LiveStatus } from '../api/types.ts';

const LIVE_THRESHOLD = 0.995; // Anything ≥ this counts as "snap to live"

export default function Live() {
  const status = useLiveStatus();
  const frames = useLiveFrames();
  const [t, setT] = useState(1);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const rafRef = useRef<number | null>(null);

  // In live mode, glue t to 1 every animation frame so the cursor sits at
  // the right edge and the graph window advances as new frames arrive.
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

  // Slider hand-off: setT comes from the dock's bottom timeline. When the
  // user drags away from the right edge we flip to replay (paused).
  // When they drag back to ≥ LIVE_THRESHOLD we resume live.
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
        <LiveBanner status={status} mode={mode} />
        <div style={{ flex: 1, minHeight: 0 }}>
          <DockDirection
            t={t}
            onT={handleT}
            mode={mode}
            onMode={setMode}
            duration={1}
            density="compact"
            graphStyle="line"
            frames={frames}
          />
        </div>
      </div>
    </SignalsProvider>
  );
}

function LiveBanner({ status, mode }: { status: LiveStatus; mode: 'live' | 'replay' }) {
  const color =
    mode === 'replay'
      ? '#e0b066'
      : status.basestation === 'connected'
      ? '#7ec98f'
      : '#e06c6c';
  const stateLabel = mode === 'replay'
    ? 'PAUSED (drag slider right to resume)'
    : `BASESTATION: ${status.basestation.toUpperCase()}`;
  return (
    <div className="h-7 px-4 flex items-center gap-3 border-b border-[color:var(--color-border)] font-mono text-[11px] tracking-widest">
      <span style={{ color }}>●</span>
      <span className="text-[color:var(--color-text-mute)]">
        {stateLabel}
        {status.port && mode === 'live' ? ` · ${status.port}` : ''}
      </span>
      {status.session_id && mode === 'live' && (
        <span className="text-[color:var(--color-text-mute)]">
          · RECORDING {status.session_id.slice(0, 8)}
        </span>
      )}
    </div>
  );
}
