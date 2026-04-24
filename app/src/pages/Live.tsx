import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';
import { useLiveFrames } from '../hooks/useLiveFrames.ts';
import { useLiveStatus } from '../hooks/useLiveStatus.ts';
import type { LiveStatus } from '../api/types.ts';

export default function Live() {
  const status = useLiveStatus();
  const frames = useLiveFrames();
  return (
    <SignalsProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <LiveBanner status={status} />
        <div style={{ flex: 1, minHeight: 0 }}>
          <DockDirection
            t={1}
            onT={() => {}}
            mode="live"
            onMode={() => {}}
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

function LiveBanner({ status }: { status: LiveStatus }) {
  const color = status.basestation === 'connected' ? '#7ec98f' : '#e06c6c';
  return (
    <div className="h-7 px-4 flex items-center gap-3 border-b border-[color:var(--color-border)] font-mono text-[11px] tracking-widest">
      <span style={{ color }}>●</span>
      <span className="text-[color:var(--color-text-mute)]">
        BASESTATION: {status.basestation.toUpperCase()}
        {status.port ? ` · ${status.port}` : ''}
      </span>
      {status.session_id && (
        <span className="text-[color:var(--color-text-mute)]">
          · RECORDING {status.session_id.slice(0, 8)}
        </span>
      )}
    </div>
  );
}
