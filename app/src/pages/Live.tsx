import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignalsProvider, useCatalog } from '../components/SignalsProvider.tsx';
import { DockDirection } from '@nfr/widgets';
import { SessionPicker } from '../components/SessionPicker.tsx';
import { useLiveTodayFrames } from '../hooks/useLiveTodayFrames.ts';
import { effectiveWidgetSignalIds, getGgSource } from '@nfr/widgets';
import { useLiveStatus } from '../hooks/useLiveStatus.ts';
import { apiGet, apiPost } from '../api/client.ts';
import type { SignalCatalog } from '@nfr/widgets';

interface SimStatus { running: boolean; signalIds: number[] }

/** Top-bar slot for the live page: link-quality badge (acts as a button)
 *  + tools modal + session picker. Owns the modal state and polls the
 *  simulator status so the badge can show 'SIM' while a test is active. */
function LiveTopBar({
  catalog, onReset,
}: {
  catalog: SignalCatalog;
  onReset: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [sim, setSim] = useState<SimStatus>({ running: false, signalIds: [] });
  const refreshSim = async () => {
    try {
      setSim(await apiGet<SimStatus>('/api/live/simulate/status'));
    } catch {/* badge falls back to running=false */}
  };
  // Mount-time fetch + poll every 5 s so a refresh, or a simulation started
  // from another window, surfaces in the badge.
  useEffect(() => {
    void refreshSim();
    const iv = setInterval(() => { void refreshSim(); }, 5000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <LinkQualityBadge
        testRunning={sim.running}
        onClick={() => setModalOpen(true)}
      />
      <SessionPicker />
      {modalOpen && (
        <LiveToolsModal
          catalog={catalog}
          sim={sim}
          onSimChange={(next) => setSim(next)}
          onReset={onReset}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

/** Modal launched from the link-quality badge. Two sections:
 *  - Reset: wipes live_today on the desktop.
 *  - Test: pick signals from the catalog → POST /api/live/simulate/start;
 *    when running, the modal shows a Stop button and a list of what's
 *    being driven. Synthetic frames flow through the same WS path real
 *    frames do, so the dock can't tell them apart. */
function LiveToolsModal({
  catalog, sim, onSimChange, onReset, onClose,
}: {
  catalog: SignalCatalog;
  sim: SimStatus;
  onSimChange: (next: SimStatus) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set(sim.signalIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only show signals that actually carry a usable range — anything where
  // min === max (or both are the catalog's 0/1 default) would simulate as
  // a flat line, which isn't a useful test target. Filtering here keeps
  // the dropdown to "valid DBC signals" the way the user expects.
  const validSignals = useMemo(
    () => catalog.ALL.filter((s) => Number.isFinite(s.min) && Number.isFinite(s.max) && s.max > s.min),
    [catalog],
  );
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return validSignals.slice(0, 200);
    return validSignals
      .filter((s) => s.name.toLowerCase().includes(q) || s.groupName.toLowerCase().includes(q))
      .slice(0, 200);
  }, [validSignals, filter]);

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const doReset = async () => {
    if (!confirm('Wipe live_today? This deletes every row in the daily buffer.')) return;
    setBusy(true); setErr(null);
    try {
      await apiPost('/api/live/reset', {});
      onReset();
      onClose();
    } catch (e) {
      setErr(`Reset failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  const start = async () => {
    if (selected.size === 0) { setErr('Pick at least one signal first.'); return; }
    setBusy(true); setErr(null);
    try {
      // Resolve each id back to its catalog signal so we can ship min/max
      // (the server has no min/max columns to query).
      const signals: Array<{ id: number; name: string; min: number; max: number }> = [];
      for (const id of selected) {
        const sig = catalog.resolve(id);
        if (sig && Number.isFinite(sig.min) && Number.isFinite(sig.max) && sig.max > sig.min) {
          signals.push({ id: sig.id, name: sig.name, min: sig.min, max: sig.max });
        }
      }
      if (signals.length === 0) {
        setErr('No selected signals have a usable min/max range.');
        return;
      }
      const r = await apiPost<SimStatus>('/api/live/simulate/start', { signals });
      onSimChange(r);
      onClose();
    } catch (e) {
      setErr(`Start failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost<SimStatus>('/api/live/simulate/stop', {});
      onSimChange(r);
    } catch (e) {
      setErr(`Stop failed: ${String(e)}`);
    } finally { setBusy(false); }
  };

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const panel: React.CSSProperties = {
    width: 'min(560px, 92vw)', maxHeight: '85vh',
    background: '#1e1f22', border: '1px solid rgba(255,255,255,0.12)',
    boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column', minHeight: 0,
    fontFamily: '"JetBrains Mono", monospace', color: '#dfe1e5',
  };
  const headerStyle: React.CSSProperties = {
    padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={headerStyle}>
          <span style={{ fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,0.5)' }}>
            LIVE TOOLS
          </span>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>×</span>
        </div>

        <div style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          {err && (
            <div style={{
              border: '1px solid rgba(242,87,87,0.4)', color: '#f4a8a8',
              padding: '6px 10px', fontSize: 10,
            }}>{err}</div>
          )}

          <section>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
              RESET LIVE DATA
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 8, lineHeight: 1.5 }}>
              Wipes <code>live_today</code> on the desktop and clears the in-memory
              dock store. Useful for re-seeding a basestation test from a clean
              slate.
            </div>
            <button
              type="button" disabled={busy} onClick={doReset}
              style={{
                padding: '6px 14px',
                background: 'transparent', color: '#f87171',
                border: '1px solid rgba(242,87,87,0.4)',
                fontFamily: 'inherit', fontSize: 11, letterSpacing: 1.5,
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >■ RESET</button>
          </section>

          <section>
            <div style={{ fontSize: 10, letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
              TEST WITH SYNTHETIC DATA {sim.running && <span style={{ color: '#7ec98f' }}>· RUNNING</span>}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 8, lineHeight: 1.5 }}>
              Pick signals from the DBC catalog. The server emits a 10 Hz
              sine-wave per signal through the full live pipeline (parser-event
              fan-out → WS broadcast → dock store → graph), exactly the same
              path real basestation frames take. Each signal swings between
              its catalog min/max so the graphs visibly move.
            </div>

            {sim.running ? (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                fontSize: 11, color: 'rgba(255,255,255,0.7)',
              }}>
                <div>Currently driving {sim.signalIds.length} signal(s).</div>
                <button
                  type="button" disabled={busy} onClick={stop}
                  style={{
                    alignSelf: 'flex-start', padding: '6px 14px',
                    background: 'rgba(242,87,87,0.18)', color: '#f4a8a8',
                    border: '1px solid rgba(242,87,87,0.5)',
                    fontFamily: 'inherit', fontSize: 11, letterSpacing: 1.5,
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >■ STOP TEST</button>
              </div>
            ) : (
              <>
                <input
                  type="text" placeholder="filter signals…"
                  value={filter} onChange={(e) => setFilter(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '5px 8px', fontSize: 11, fontFamily: 'inherit',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'inherit', marginBottom: 6,
                  }}
                />
                <div style={{
                  maxHeight: 220, overflow: 'auto',
                  border: '1px solid rgba(255,255,255,0.08)',
                  fontSize: 10, marginBottom: 8,
                }}>
                  {filtered.map((s) => (
                    <label key={s.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '3px 8px', cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                      />
                      <span style={{ color: 'rgba(255,255,255,0.85)' }}>{s.name}</span>
                      <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>
                        {s.groupName}
                      </span>
                    </label>
                  ))}
                  {filtered.length === 0 && (
                    <div style={{ padding: 10, color: 'rgba(255,255,255,0.4)' }}>no matches</div>
                  )}
                </div>
                <button
                  type="button" disabled={busy || selected.size === 0} onClick={start}
                  style={{
                    padding: '6px 14px',
                    background: 'rgba(126,201,143,0.18)', color: '#a5dfb4',
                    border: '1px solid rgba(126,201,143,0.5)',
                    fontFamily: 'inherit', fontSize: 11, letterSpacing: 1.5,
                    cursor: busy || selected.size === 0 ? 'not-allowed' : 'pointer',
                    opacity: selected.size === 0 ? 0.5 : 1,
                  }}
                >▶ START TEST ({selected.size})</button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Clickable LoRa link health pill. Shows rssi/snr from useLiveStatus,
 *  opens the LiveToolsModal on click. Border turns green while a test
 *  simulation is running so it's clear from the top bar alone that the
 *  data on screen is synthetic. */
function LinkQualityBadge({
  onClick, testRunning,
}: {
  onClick: () => void;
  testRunning: boolean;
}) {
  const status = useLiveStatus();
  const rssi = status.rssi;
  const snr = status.snr;
  const connected = status.basestation === 'connected';
  // Colour by RSSI: stronger is brighter. -70 dBm is comfortable, below
  // -100 starts losing packets in practice.
  const rssiColor =
    !connected || rssi == null ? '#6f7278'
    : rssi >= -70 ? '#7ec98f'
    : rssi >= -90 ? '#e8a648'
    : '#e06c6c';
  const borderColor = testRunning ? 'rgba(126,201,143,0.9)' : 'rgba(255,255,255,0.09)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={testRunning ? 'SIMULATION RUNNING — click to open Live tools' : 'Live tools (reset / simulate)'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', marginRight: 8,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10, letterSpacing: 1,
        background: 'transparent',
        border: `1px solid ${borderColor}`,
        color: rssiColor,
        cursor: 'pointer',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: testRunning ? '#7ec98f' : (connected ? rssiColor : '#6f7278'),
        opacity: testRunning || connected ? 1 : 0.4,
      }} />
      {testRunning && <span style={{ color: '#7ec98f', fontWeight: 600 }}>SIM</span>}
      <span>RSSI {rssi != null ? `${rssi}` : '—'} dBm</span>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
      <span>SNR {snr != null ? snr.toFixed(1) : '—'} dB</span>
    </button>
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

  // Visible window. visEnd auto-advances to "now" while at the live edge.
  // visStart is anchored to the first timestamp the store has seen — so
  // the slider stays at 0 until real data arrives.
  // `frozenWindow`, when set, freezes both ends — that's how zoom works on
  // the live page. Data ingestion (WS push, ensureWindow) keeps running;
  // we just stop following the edge in the UI.
  const [visEnd, setVisEnd] = useState<string>(() => new Date().toISOString());
  const [frozenWindow, setFrozenWindow] = useState<{ start: string; end: string } | null>(null);
  // True when the user clicked LIVE in the bottom-left to freeze the
  // visible window without dragging the slider. Data ingestion (WS push,
  // catchup fetch) keeps running — only the visEnd advance stops.
  const [paused, setPaused] = useState(false);
  // The earliest timestamp the store has seen — re-reads when frames push.
  const storeFirstTs = store.firstTs();
  const liveStart = storeFirstTs ?? visEnd;
  const visStart = frozenWindow?.start ?? liveStart;
  const effectiveVisEnd = frozenWindow?.end ?? visEnd;
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

  // At the live edge AND not zoomed AND not paused, advance visEnd every
  // 250 ms so the dock follows the streaming front. When the user zooms
  // or hits pause, this effect goes idle and the visible window freezes.
  useEffect(() => {
    if (frozenWindow !== null) return;
    if (paused) return;
    if (t < LIVE_THRESHOLD) return;
    const iv = setInterval(() => setVisEnd(new Date().toISOString()), 250);
    return () => clearInterval(iv);
  }, [t, frozenWindow, paused]);

  // Day rollover: if midnight Chicago passes, drop the in-memory store
  // (so old frames stop appearing under the new day's slider) and clear
  // any zoom freeze.
  const [dayAnchor, setDayAnchor] = useState<string>(() => chicagoMidnightIso());
  useEffect(() => {
    const checkRollover = () => {
      const todayMidnight = chicagoMidnightIso();
      if (todayMidnight !== dayAnchor) {
        store.reset();
        setFrozenWindow(null);
        setDayAnchor(todayMidnight);
        setVisEnd(new Date().toISOString());
      }
    };
    const iv = setInterval(checkRollover, 60_000);
    return () => clearInterval(iv);
  }, [dayAnchor, store]);

  // Zoom handler: drag-select on a graph fires this with [a, b] fractions
  // of the current window. Convert to absolute timestamps and freeze.
  // Reset (null) returns to following the live edge.
  const handleZoom = (z: [number, number] | null) => {
    if (z === null) {
      setFrozenWindow(null);
      setT(1);
      return;
    }
    const startMs = Date.parse(visStart);
    const endMs = Date.parse(effectiveVisEnd);
    const span = endMs - startMs;
    if (!Number.isFinite(span) || span <= 0) return;
    setFrozenWindow({
      start: new Date(startMs + z[0] * span).toISOString(),
      end: new Date(startMs + z[1] * span).toISOString(),
    });
    // Drop below LIVE_THRESHOLD so the slider visually shows we're no
    // longer at the live edge.
    setT(0.5);
  };

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
    ? Math.max(0, (Date.parse(effectiveVisEnd) - Date.parse(visStart)) / 1000)
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
        onZoom={handleZoom}
        zoomActive={frozenWindow !== null}
        windowStartTs={visStart}
        windowEndTs={effectiveVisEnd}
        paused={paused}
        onTogglePause={() => {
          // Resuming snaps visEnd back to "now" so the auto-advance picks
          // up cleanly without showing a stale right edge for 250 ms.
          if (paused) setVisEnd(new Date().toISOString());
          setPaused((p) => !p);
        }}
        sessionSlot={
          <LiveTopBar
            catalog={catalog}
            onReset={() => {
              store.reset();
              setFrozenWindow(null);
              setVisEnd(new Date().toISOString());
              setT(1);
            }}
          />
        }
      />
    </div>
  );
}
