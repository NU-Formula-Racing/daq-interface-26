import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignalsProvider, useCatalog } from '../components/SignalsProvider.tsx';
import { DockDirection } from '@nfr/widgets';
import { SessionPicker } from '../components/SessionPicker.tsx';
import { useLiveTodayFrames } from '../hooks/useLiveTodayFrames.ts';
import { effectiveWidgetSignalIds, getGgSource } from '@nfr/widgets';
import { useLiveStatus } from '../hooks/useLiveStatus.ts';

/** Top-bar pill showing LoRa link health (rssi + snr). Each parser packet
 *  brings one signal_quality event; useLiveStatus tracks the most recent. */
function LinkQualityBadge() {
  const status = useLiveStatus();
  const rssi = status.rssi;
  const snr = status.snr;
  const connected = status.basestation === 'connected';
  // Colour by RSSI: stronger is brighter. -70 dBm is comfortable, below
  // -100 starts losing packets in practice.
  const color =
    !connected || rssi == null ? '#6f7278'
    : rssi >= -70 ? '#7ec98f'
    : rssi >= -90 ? '#e8a648'
    : '#e06c6c';
  return (
    <span
      title={connected ? `Basestation ${status.port ?? ''}` : 'Basestation disconnected'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', marginRight: 8,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10, letterSpacing: 1,
        border: '1px solid rgba(255,255,255,0.09)',
        color,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: connected ? color : '#6f7278',
        opacity: connected ? 1 : 0.4,
      }} />
      <span>RSSI {rssi != null ? `${rssi}` : '—'} dBm</span>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
      <span>SNR {snr != null ? snr.toFixed(1) : '—'} dB</span>
    </span>
  );
}

const LIVE_THRESHOLD = 0.995; // Anything ≥ this counts as "snap to live"

function chicagoMidnightIso(): string {
  // Today's date in the America/Chicago timezone.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // 'en-CA' formats as YYYY-MM-DD.
  const ymd = fmt.format(new Date()); // e.g. "2026-05-28"
  const localMidnight = new Date(`${ymd}T00:00:00Z`).getTime();
  // Chicago offset in minutes for today (handles CDT/CST). Format a known
  // instant in Chicago and parse the offset back out.
  const offsetStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'longOffset',
    year: 'numeric',
  }).formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-06:00';
  const m = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMins = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -360;
  // localMidnight is the UTC instant matching "ymd 00:00 UTC"; subtract
  // Chicago's offset to get the UTC instant matching "ymd 00:00 America/Chicago".
  return new Date(localMidnight - offsetMins * 60_000).toISOString();
}

export default function Live() {
  const navigate = useNavigate();
  return (
    <SignalsProvider>
      <LiveInner navigate={navigate} />
    </SignalsProvider>
  );
}

interface LiveInnerProps {
  navigate: (path: string) => void;
}

function LiveInner({ navigate }: LiveInnerProps) {
  const catalog = useCatalog();
  const { store, ensureWindow } = useLiveTodayFrames();
  const [t, setT] = useState(1);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const rafRef = useRef<number | null>(null);

  // Visible window. visStart is null until the first frame arrives — the
  // dock should not "look like" a live session is happening when nothing
  // is streaming. Once data shows up (either WS push or the catch-up
  // ensureWindow against earlier-today rows), we anchor visStart to the
  // first timestamp the store has seen. visEnd is "now" while at the
  // live edge.
  const [visEnd, setVisEnd] = useState<string>(() => new Date().toISOString());
  const [scrollback, setScrollback] = useState<string | null>(null);
  // The earliest timestamp the store has seen — re-reads when frames push.
  const storeFirstTs = store.firstTs();
  const visStart = scrollback ?? storeFirstTs ?? visEnd;
  const hasData = storeFirstTs !== null;

  // Resolve widget-layout signal entries through the catalog and extract numeric
  // ids. Polls localStorage because the dock has no callback API for layout
  // changes. Same approach as Replay.tsx.
  const [signalIds, setSignalIds] = useState<number[]>([]);
  const lastIdsRef = useRef<string>('');
  useEffect(() => {
    if (!catalog) return;
    const tick = () => {
      try {
        const raw = localStorage.getItem('nfr-dock-layout-v2');
        const widgets = raw ? JSON.parse(raw) : [];
        const ggSrc = getGgSource();
        const ids = new Set<number>();
        // Shared expansion: auto-discovery widgets (cellv, gg) get their
        // resolved signal IDs added even when their layout entry has an
        // empty signals[] array.
        for (const w of widgets ?? []) {
          for (const id of effectiveWidgetSignalIds(w, catalog, ggSrc)) {
            ids.add(id);
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

  // At the live edge, advance visEnd every 250ms so the dock follows
  // the streaming front.
  useEffect(() => {
    if (t < LIVE_THRESHOLD) return;
    const iv = setInterval(() => setVisEnd(new Date().toISOString()), 250);
    return () => clearInterval(iv);
  }, [t]);

  // Day rollover: if midnight Chicago passes, drop the in-memory store
  // (so old frames stop appearing under the new day's slider) and clear
  // any scroll-back anchor.
  const [dayAnchor, setDayAnchor] = useState<string>(() => chicagoMidnightIso());
  useEffect(() => {
    const checkRollover = () => {
      const todayMidnight = chicagoMidnightIso();
      if (todayMidnight !== dayAnchor) {
        store.reset();
        setScrollback(null);
        setDayAnchor(todayMidnight);
        setVisEnd(new Date().toISOString());
      }
    };
    const iv = setInterval(checkRollover, 60_000);
    return () => clearInterval(iv);
  }, [dayAnchor, store]);

  // Catch-up fetch: on mount (or signal-selection change) hit /api/live/window
  // for today's Chicago-midnight → now so earlier-today rows are loaded into
  // the store. Once that returns, store.firstTs() goes non-null and the
  // slider starts counting from the actual first-data timestamp.
  useEffect(() => {
    if (signalIds.length === 0) return;
    void ensureWindow(dayAnchor, visEnd, signalIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalIds.join(','), dayAnchor, visEnd]);

  // Visible-window duration drives the dock slider. Zero until data exists.
  const elapsedSecs = hasData
    ? Math.max(0, (Date.parse(visEnd) - Date.parse(visStart)) / 1000)
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <DockDirection
        t={t}
        onT={handleT}
        mode={mode}
        onMode={setMode}
        durationSecs={elapsedSecs}
        density="compact"
        graphStyle="line"
        frames={store}
        exportHref={null}
        navigate={navigate}
        sessionSlot={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <LinkQualityBadge />
            <SessionPicker />
          </div>
        }
      />
    </div>
  );
}
