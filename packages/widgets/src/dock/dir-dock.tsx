// Direction 1 v2: DOCK — full-bleed prototype.
// Widgets live in a 12-col grid; draggable + resizable. Layout persists to localStorage.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCatalog } from '../data/contexts.tsx';
import { COLORS as SH_COLORS } from '../theme/colors.ts';
import {
  SignalChip,
  Timeline,
  TopBar,
  WidgetShell,
  WidgetIcon,
  WIDGET_TYPES,
  fmtValOrEnum,
  parseEnumMap,
  getGgSource,
  setGgSource,
  ggSignalNames,
  type GgSource,
} from '../widgets/widgets.tsx';
import type { Signal } from '../signals/catalog.ts';
import type { FramesStore } from '../data/types.ts';
import { FramesContext as FramesCtx, useFrames, HoverProvider, AvailableSignalsContext, useAvailableSignals } from '../data/contexts.tsx';
import { decideDropAction } from './dropAction.ts';
import { compactVertical } from './compactVertical.ts';

export { useFrames };

const DOCK_STORAGE_KEY = 'nfr-dock-layout-v2';

// NOTE: the original layout referenced signals by string names (e.g. 'Inverter_RPM').
// Our real catalog uses numeric ids from signal_definitions.id. If those names don't
// resolve, widgets render their EmptySlot fallback — which is the intended smoke
// behavior for this task.
// Default layout for the user's NFR 26 DBC. Signals are referenced by name
// (resolved via catalog.resolve at render time) so the layout survives DBC
// changes as long as the names match.
const DEFAULT_LAYOUT: any[] = [
  // Row 1 — four numerics: temperature, RPM, voltage, SOC
  { id: 'w1', type: 'numeric', signals: ['Battery_Temperature'], col: 1,  row: 1, w: 3, h: 3 },
  { id: 'w2', type: 'numeric', signals: ['Rear Inverter/RPM'],   col: 4,  row: 1, w: 3, h: 3 },
  { id: 'w3', type: 'numeric', signals: ['Battery_Voltage'],     col: 7,  row: 1, w: 3, h: 3 },
  { id: 'w4', type: 'numeric', signals: ['BMS_SOC'],             col: 10, row: 1, w: 3, h: 3 },

  // Row 2 — two graphs
  { id: 'w5', type: 'graph',
    signals: ['Battery_Voltage', 'Battery_Temperature'],
    window: 0.05, col: 1, row: 4, w: 6, h: 4 },
  { id: 'w6', type: 'graph',
    signals: ['Front-Left-Inverter/RPM', 'Front-Right-Inverter/RPM', 'Rear Inverter/RPM'],
    window: 0.05, col: 7, row: 4, w: 6, h: 4 },

  // Row 3 — tire heatmap (FL/FR/BL/BR × 3 of 8 thermocouples each)
  { id: 'w7', type: 'heatmap',
    signals: [
      'FL_Tire_Temp_0', 'FL_Tire_Temp_3', 'FL_Tire_Temp_7',
      'FR_Tire_Temp_0', 'FR_Tire_Temp_3', 'FR_Tire_Temp_7',
      'BL_Tire_Temp_0', 'BL_Tire_Temp_3', 'BL_Tire_Temp_7',
      'BR_Tire_Temp_0', 'BR_Tire_Temp_3', 'BR_Tire_Temp_7',
    ],
    col: 1, row: 8, w: 12, h: 4 },
];

function loadLayout(): any[] {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) {}
  return DEFAULT_LAYOUT;
}

interface DockDirectionProps {
  exportHref?: string | null;
  t: number;
  onT: (t: number) => void;
  mode: 'live' | 'replay';
  onMode: (m: 'live' | 'replay') => void;
  /** Total session duration in seconds (drives the bottom timer). */
  durationSecs: number;
  density: string;
  graphStyle: 'line' | 'area' | 'step';
  frames?: FramesStore;
  /** Called when user navigates (e.g. to /settings or /sessions/:id). */
  navigate?: (path: string) => void;
  /** Slot for a session picker component (desktop-specific). */
  sessionSlot?: React.ReactNode;
  /** Show the IMPORT NFR + DBC upload buttons. False on the website,
   *  where signal/data ingestion is desktop-only. Default true. */
  allowDataImport?: boolean;
  /** If provided, the signal pickers hide signals whose id is not in this set.
   *  null = no filter (desktop default — all catalog signals shown). */
  availableSignalIds?: ReadonlySet<number> | null;
  /** Notified when any widget's zoom range changes. Use to drive a global
   *  visible-window fetch. `null` = the widget reset its zoom. */
  onZoom?: (z: [number, number] | null) => void;
  /** True when the orchestrator's visible window is narrower than the full
   *  session. Drives the in-graph "reset zoom" corner button visibility. */
  zoomActive?: boolean;
  /** ISO timestamp of the session start. Forwarded to widgets so their
   *  x-axis labels read as elapsed-into-session at any zoom level. */
  sessionStartTs?: string | null;
}

const DROPPABLE_TYPES = [
  { id: 'graph', label: 'GRAPH', icon: 'graph' },
  { id: 'numeric', label: 'NUMERIC', icon: 'num' },
  { id: 'gauge', label: 'GAUGE', icon: 'gauge' },
  { id: 'bar', label: 'BAR', icon: 'bar' },
  { id: 'heatmap', label: 'HEATMAP', icon: 'heat' },
];

function DropTypePopup({
  onPick,
  onCancel,
}: {
  onPick: (type: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: SH_COLORS.bg,
          border: `1px solid ${SH_COLORS.border}`,
          padding: 16,
          minWidth: 240,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: SH_COLORS.textMute, marginBottom: 10 }}>
          DISPLAY AS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {DROPPABLE_TYPES.map((wt) => (
            <button
              key={wt.id}
              onClick={() => onPick(wt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', background: 'transparent',
                color: SH_COLORS.text, border: `1px solid ${SH_COLORS.border}`,
                fontSize: 11, letterSpacing: 1, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <WidgetIcon kind={wt.icon} />
              <span>{wt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DockDirection({ t, mode, onMode, onT, durationSecs, density, graphStyle, frames, exportHref, navigate, sessionSlot, allowDataImport = true, availableSignalIds = null, onZoom, zoomActive, sessionStartTs }: DockDirectionProps) {
  const catalog = useCatalog();
  const [widgets, setWidgets] = useState<any[]>(loadLayout);
  const [selectedSignal, setSelectedSignal] = useState<any>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [inspectorQuery, setInspectorQuery] = useState('');
  useEffect(() => { setInspectorQuery(''); }, [focusedId]);
  const [favorites, setFavorites] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('nfr-favs') || '[]'); } catch { return []; }
  });
  const [railW, setRailW] = useState(() => {
    const v = parseInt(localStorage.getItem('nfr-rail-w') || '260', 10);
    return isNaN(v) ? 260 : v;
  });
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem('nfr-rail-open') !== '0');
  useEffect(() => { localStorage.setItem('nfr-rail-w', String(railW)); }, [railW]);
  useEffect(() => { localStorage.setItem('nfr-rail-open', railOpen ? '1' : '0'); }, [railOpen]);
  const FILTER_KEY = 'nfr_signal_filter';
  const [signalFilter, setSignalFilter] = useState<'all' | 'active'>(() => {
    if (typeof window === 'undefined') return 'all';
    const v = window.localStorage.getItem(FILTER_KEY);
    return v === 'active' ? 'active' : 'all';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(FILTER_KEY, signalFilter);
  }, [signalFilter]);
  const startRailResize = (e: any) => {
    e.preventDefault();
    const sx = e.clientX, ow = railW;
    const mv = (ev: any) => setRailW(Math.max(180, Math.min(520, ow + (ev.clientX - sx))));
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  };
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<any>(null);
  const [hoverCell, setHoverCell] = useState<any>(null);
  const [pendingDrop, setPendingDrop] = useState<{ signalId: any } | null>(null);

  // Persist
  useEffect(() => {
    try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(widgets)); } catch {}
  }, [widgets]);
  useEffect(() => {
    try { localStorage.setItem('nfr-favs', JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  const COLS = 12;
  const patch = (id: string, next: any) => setWidgets((ws) => ws.map((w) => w.id === id ? (typeof next === 'function' ? next(w) : { ...w, ...next }) : w));
  const remove = (id: string) => {
    setWidgets((ws) => compactVertical(ws.filter((w) => w.id !== id)));
    if (focusedId === id) setFocusedId(null);
  };
  const resetLayout = () => setWidgets(DEFAULT_LAYOUT);

  const addWidget = (type: string, signalOverride?: any) => {
    const sig = signalOverride ?? selectedSignal ?? 'Inverter_RPM';
    const id = 'w' + Date.now().toString(36);
    const lastRow = Math.max(0, ...widgets.map((w) => w.row + w.h - 1));
    const multiTypes = ['graph', 'bar', 'heatmap'];
    setWidgets((ws) => [...ws, {
      id, type,
      signals: multiTypes.includes(type) ? [sig] : [sig],
      window: 0.05, col: 1, row: lastRow + 1,
      w: type === 'numeric' ? 3 : type === 'gauge' ? 4 : type === 'gg' ? 5 : 6,
      h: type === 'gg' ? 7 : 3,
    }]);
    setFocusedId(id);
  };

  // Drag/resize math — convert pixel delta to grid cells
  const cellSize = () => {
    if (!gridRef.current) return { cw: 80, ch: 40 };
    const r = gridRef.current.getBoundingClientRect();
    const style = getComputedStyle(gridRef.current);
    const gap = parseFloat(style.gap) || 4;
    const cw = (r.width - gap * (COLS - 1) - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) / COLS;
    const ch = 44; // auto-row size
    return { cw: cw + gap, ch: ch + gap };
  };

  const startMove = (w: any, e: any) => {
    e.preventDefault(); e.stopPropagation();
    const { cw, ch } = cellSize();
    const origin = { x: e.clientX, y: e.clientY, col: w.col, row: w.row };
    setDrag({ id: w.id, kind: 'move', origin, cw, ch });
    const move = (ev: any) => {
      const dc = Math.round((ev.clientX - origin.x) / cw);
      const dr = Math.round((ev.clientY - origin.y) / ch);
      const nc = Math.max(1, Math.min(COLS - w.w + 1, origin.col + dc));
      const nr = Math.max(1, origin.row + dr);
      setHoverCell({ col: nc, row: nr, w: w.w, h: w.h });
    };
    const up = (ev: any) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const dc = Math.round((ev.clientX - origin.x) / cw);
      const dr = Math.round((ev.clientY - origin.y) / ch);
      const nc = Math.max(1, Math.min(COLS - w.w + 1, origin.col + dc));
      const nr = Math.max(1, origin.row + dr);
      patch(w.id, { col: nc, row: nr });
      setDrag(null); setHoverCell(null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const startResize = (w: any, e: any) => {
    e.preventDefault(); e.stopPropagation();
    const { cw, ch } = cellSize();
    const origin = { x: e.clientX, y: e.clientY, w: w.w, h: w.h };
    setDrag({ id: w.id, kind: 'resize', origin, cw, ch });
    const move = (ev: any) => {
      const dw = Math.round((ev.clientX - origin.x) / cw);
      const dh = Math.round((ev.clientY - origin.y) / ch);
      const nw = Math.max(2, Math.min(COLS - w.col + 1, origin.w + dw));
      const nh = Math.max(2, origin.h + dh);
      setHoverCell({ col: w.col, row: w.row, w: nw, h: nh });
    };
    const up = (ev: any) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      const dw = Math.round((ev.clientX - origin.x) / cw);
      const dh = Math.round((ev.clientY - origin.y) / ch);
      const nw = Math.max(2, Math.min(COLS - w.col + 1, origin.w + dw));
      const nh = Math.max(2, origin.h + dh);
      patch(w.id, { w: nw, h: nh });
      setDrag(null); setHoverCell(null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const toggleFav = (id: any) => setFavorites((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);

  // maxRow retained for parity with the original even if unused in JSX.
  void Math.max(12, ...widgets.map((w) => w.row + w.h - 1), (hoverCell?.row || 0) + (hoverCell?.h || 0) - 1);

  const fileRef = useRef<HTMLInputElement>(null);
  const nfrFileRef = useRef<HTMLInputElement>(null);
  const nfrFolderRef = useRef<HTMLInputElement>(null);
  const [dbcStatus, setDbcStatus] = useState<string>('');
  const [nfrStatus, setNfrStatus] = useState<string>('');
  const [nfrModalOpen, setNfrModalOpen] = useState(false);
  const [reparseOnImport, setReparseOnImport] = useState(false);
  // Hold the checkbox state in a ref so onPickNfr's file-input handler reads
  // the latest value at click-time without re-binding the input listener.
  const reparseRef = useRef(false);
  reparseRef.current = reparseOnImport;
  const [dbcMenuOpen, setDbcMenuOpen] = useState(false);
  const [dbcViewerOpen, setDbcViewerOpen] = useState(false);
  const onPickDbc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setDbcStatus('Uploading…');
    try {
      const text = await f.text();
      const res = await fetch('/api/dbc/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      if (!res.ok) {
        setDbcStatus(`Failed: ${(await res.text()).slice(0, 60)}`);
        return;
      }
      setDbcStatus('Reloading…');
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setDbcStatus(`Error: ${String(err)}`);
    }
  };

  // Overlay state — shown during NFR import so the user has clear progress feedback.
  const [importState, setImportState] = useState<{
    open: boolean;
    total: number;
    index: number;
    currentFile: string;
    succeeded: number;
    skipped: number;
    failed: number;
    cancelled: number;
    totalRows: number;
    skippedFiles: string[];
    errors: string[];
    done: boolean;
    wasCancelled: boolean;
  } | null>(null);
  // Cancel flag so the overlay's CANCEL button can stop the queue from
  // advancing. The in-flight parser is killed server-side via /api/import/cancel.
  const importCancelFlagRef = useRef(false);

  const onPickNfr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Snapshot the files BEFORE resetting the input — `e.target.files` is a
    // live FileList that gets cleared when we set the value to ''.
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (picked.length === 0) return;

    const nfrs = picked.filter((f) => /\.nfr$/i.test(f.name));
    if (nfrs.length === 0) {
      setNfrStatus(`No .nfr files in selection (${picked.map((f) => f.name).join(', ')})`);
      setTimeout(() => setNfrStatus(''), 8000);
      return;
    }

    importCancelFlagRef.current = false;
    setImportState({
      open: true,
      total: nfrs.length,
      index: 0,
      currentFile: nfrs[0].name,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      cancelled: 0,
      totalRows: 0,
      skippedFiles: [],
      errors: [],
      done: false,
      wasCancelled: false,
    });

    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    let cancelled = 0;
    let totalRows = 0;
    const skippedFiles: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < nfrs.length; i++) {
      if (importCancelFlagRef.current) {
        cancelled += nfrs.length - i;
        break;
      }
      const f = nfrs[i];
      setImportState((s) => s && { ...s, index: i, currentFile: f.name });
      try {
        const buf = await f.arrayBuffer();
        const url = reparseRef.current
          ? '/api/import/nfr?reparse=1'
          : '/api/import/nfr';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': f.name,
          },
          body: buf,
        });
        const body = await res.json().catch(() => ({} as any));
        if (!res.ok || body?.error) {
          if (body?.error === 'cancelled' || importCancelFlagRef.current) {
            cancelled++;
          } else {
            failed++;
            errors.push(`${f.name}: ${body?.error ?? `HTTP ${res.status}`}`);
          }
        } else if (body?.skipped) {
          skipped++;
          skippedFiles.push(f.name);
        } else {
          succeeded++;
          totalRows += body.row_count ?? 0;
        }
      } catch (err) {
        if (importCancelFlagRef.current) {
          cancelled++;
        } else {
          failed++;
          errors.push(`${f.name}: ${String(err)}`);
        }
      }
      setImportState((s) =>
        s && { ...s, succeeded, skipped, failed, cancelled, totalRows, skippedFiles: [...skippedFiles], errors: [...errors] },
      );
    }

    setImportState((s) => s && {
      ...s,
      done: true,
      index: nfrs.length,
      cancelled,
      wasCancelled: importCancelFlagRef.current,
    });
    setNfrStatus(
      importCancelFlagRef.current
        ? `Cancelled · ${succeeded} parsed · ${cancelled} skipped via cancel${failed > 0 ? ` · ${failed} failed` : ''}`
        : `Imported ${succeeded}/${nfrs.length} · ${totalRows.toLocaleString()} rows${skipped > 0 ? ` · ${skipped} skipped` : ''}${failed > 0 ? ` · ${failed} failed` : ''}`,
    );
    setTimeout(() => setNfrStatus(''), 8000);
  };

  return (
    <FramesCtx.Provider value={frames ?? null}>
    <HoverProvider>
    <AvailableSignalsContext.Provider value={availableSignalIds ?? null}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <TopBar
        mode={mode}
        onMode={onMode}
        title="NFR · DAQ"
        compact
        sessionSlot={sessionSlot}
        onLogoClick={navigate ? () => navigate('/') : undefined}
        nav={
          <button
            onClick={() => navigate?.('/settings')}
            title="Settings"
            style={{
              ...smallBtn(),
              padding: '4px 8px',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ⚙
          </button>
        }
        right={
          <>
            {allowDataImport && (
              <>
                {nfrStatus && (
                  <span style={{ color: SH_COLORS.textMute, fontSize: 9, marginRight: 4 }}>{nfrStatus}</span>
                )}
                <input
                  ref={nfrFileRef}
                  type="file"
                  accept=".nfr,.NFR,application/octet-stream"
                  multiple
                  style={{ display: 'none' }}
                  onChange={onPickNfr}
                />
                <input
                  ref={nfrFolderRef}
                  type="file"
                  // @ts-expect-error — non-standard but supported in Chromium/Safari/FF
                  webkitdirectory=""
                  directory=""
                  multiple
                  style={{ display: 'none' }}
                  onChange={onPickNfr}
                />
                <button onClick={() => setNfrModalOpen(true)} style={smallBtn()} title="Import .nfr files">↑ IMPORT NFR</button>
                <span style={{ width: 1, height: 12, background: SH_COLORS.border, margin: '0 4px' }} />
                {dbcStatus && (
                  <span style={{ color: SH_COLORS.textMute, fontSize: 9, marginRight: 4 }}>{dbcStatus}</span>
                )}
                <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onPickDbc} />
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    onClick={() => setDbcMenuOpen((v) => !v)}
                    style={smallBtn()}
                    title="DBC actions"
                  >DBC ▾</button>
                  {dbcMenuOpen && (
                    <>
                      <div
                        onClick={() => setDbcMenuOpen(false)}
                        style={{ position: 'fixed', inset: 0, zIndex: 90 }}
                      />
                      <div style={{
                        position: 'absolute', top: '100%', right: 0, marginTop: 4,
                        background: SH_COLORS.bg,
                        border: `1px solid ${SH_COLORS.border}`,
                        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
                        zIndex: 91, minWidth: 180,
                        fontFamily: '"JetBrains Mono", monospace',
                      }}>
                        <button
                          onClick={() => { setDbcMenuOpen(false); fileRef.current?.click(); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            background: 'transparent', border: 'none',
                            color: SH_COLORS.text, fontSize: 10, letterSpacing: 1.5,
                            padding: '8px 12px', cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >↑ IMPORT NEW DBC…</button>
                        <button
                          onClick={() => { setDbcMenuOpen(false); setDbcViewerOpen(true); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            background: 'transparent', border: 'none',
                            color: SH_COLORS.text, fontSize: 10, letterSpacing: 1.5,
                            padding: '8px 12px', cursor: 'pointer', borderTop: `1px solid ${SH_COLORS.border}`,
                            fontFamily: 'inherit',
                          }}
                        >VIEW CURRENT DBC</button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            <button onClick={resetLayout} style={smallBtn()} title="Reset layout to default">⟲ RESET</button>
            {exportHref ? (
              <a href={exportHref} download style={{ ...smallBtn(), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} title="Export current session as CSV">↓ EXPORT</a>
            ) : (
              <button style={{ ...smallBtn(), opacity: 0.4, cursor: 'not-allowed' }} title="No active session" disabled>↓ EXPORT</button>
            )}
          </>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left rail — collapsible + resizable */}
        {railOpen ? (
          <div style={{ width: railW, flexShrink: 0, borderRight: `1px solid ${SH_COLORS.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, background: SH_COLORS.bg, position: 'relative' }}>
            <div style={{ display: 'flex', gap: 0, padding: '6px 10px 0 10px', background: SH_COLORS.bg }}>
              <button
                onClick={() => setSignalFilter('all')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 9,
                  letterSpacing: 1.5,
                  cursor: 'pointer',
                  background: signalFilter === 'all' ? SH_COLORS.bgElev : 'transparent',
                  color: signalFilter === 'all' ? SH_COLORS.text : SH_COLORS.textMute,
                  border: `1px solid ${SH_COLORS.border}`,
                  borderRight: 'none',
                }}
              >
                ALL
              </button>
              <button
                onClick={() => setSignalFilter('active')}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 9,
                  letterSpacing: 1.5,
                  cursor: 'pointer',
                  background: signalFilter === 'active' ? SH_COLORS.bgElev : 'transparent',
                  color: signalFilter === 'active' ? SH_COLORS.text : SH_COLORS.textMute,
                  border: `1px solid ${SH_COLORS.border}`,
                }}
              >
                ACTIVE
              </button>
            </div>
            <DockSignalPicker
              selected={selectedSignal}
              onPick={(s) => setSelectedSignal(s === selectedSignal ? null : s)}
              favorites={favorites}
              onToggleFav={(id) => setFavorites((favs) => favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id])}
              onCollapse={() => setRailOpen(false)}
              activeOnly={signalFilter === 'active'}
            />
            <div onPointerDown={startRailResize} title="Drag to resize" style={{
              position: 'absolute', top: 0, bottom: 0, right: -3, width: 6, cursor: 'ew-resize', zIndex: 2,
            }} />
          </div>
        ) : (
          <div onClick={() => setRailOpen(true)} title="Show signals"
            style={{ width: 24, flexShrink: 0, borderRight: `1px solid ${SH_COLORS.border}`, background: SH_COLORS.bg,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10, cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textMute, letterSpacing: 1.5, writingMode: 'vertical-rl' }}>
            » SIGNALS
          </div>
        )}

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Action bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            background: SH_COLORS.bg, borderBottom: `1px solid ${SH_COLORS.border}`,
          }}>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: SH_COLORS.textFaint, letterSpacing: 1.5 }}>LAYOUT · {widgets.length}</span>
            {selectedSignal && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textMute, marginLeft: 10 }}>
                <span>ADD WITH</span>
                <SignalChip sigId={selectedSignal} size="xs" onRemove={() => setSelectedSignal(null)} />
              </span>
            )}
            <span style={{ flex: 1 }} />
            {WIDGET_TYPES.map((wt) => (
              <button key={wt.id} onClick={() => addWidget(wt.id)} style={smallBtn()}>
                <WidgetIcon kind={wt.icon} /> <span style={{ marginLeft: 4 }}>+ {wt.label}</span>
              </button>
            ))}
          </div>

          {/* Grid */}
          <div
            ref={gridRef}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('application/x-nfr-signal')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(e) => {
              const sid = e.dataTransfer.getData('application/x-nfr-signal');
              if (!sid) return;
              e.preventDefault();
              setPendingDrop({ signalId: sid });
            }}
            style={{
            flex: 1, padding: 8, overflow: 'auto',
            display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`,
            gridAutoRows: '44px', gap: 4, minHeight: 0,
            backgroundImage: `linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px)`,
            backgroundSize: '100% 48px',
          }}>
            {widgets.map((w) => {
              const isDragging = drag?.id === w.id;
              const preview = isDragging && hoverCell ? hoverCell : w;
              return (
                <div
                  key={w.id}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('application/x-nfr-signal')) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      e.stopPropagation();
                    }
                  }}
                  onDrop={(e) => {
                    const sid = e.dataTransfer.getData('application/x-nfr-signal');
                    if (!sid) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const action = decideDropAction(w, sid);
                    if (action.kind === 'patch') {
                      patch(w.id, action.next);
                    }
                  }}
                  style={{
                  gridColumn: `${preview.col} / span ${preview.w}`,
                  gridRow: `${preview.row} / span ${preview.h}`,
                  minWidth: 0, minHeight: 0, position: 'relative',
                  outline: focusedId === w.id ? `1px solid ${SH_COLORS.accentBright}` : 'none',
                  outlineOffset: -1,
                  opacity: isDragging ? 0.85 : 1,
                  zIndex: isDragging ? 10 : 1,
                  transition: isDragging ? 'none' : 'opacity 120ms',
                }}
                >
                  <WidgetShell widget={w} t={t} mode={mode}
                    density={density} graphStyle={graphStyle}
                    onChange={(next) => patch(w.id, next)}
                    onRemove={() => remove(w.id)}
                    onSettings={() => setFocusedId(w.id)}
                    onZoom={onZoom}
                    zoomActive={zoomActive}
                    sessionStartTs={sessionStartTs}
                    draggable
                    onDragStart={(e) => startMove(w, e)}
                  />
                  <div onPointerDown={(e) => startResize(w, e)} style={{
                    position: 'absolute', right: 0, bottom: 0, width: 12, height: 12,
                    cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.25) 50%)',
                  }} />
                </div>
              );
            })}
            {/* Drop preview ghost */}
            {hoverCell && drag && (
              <div style={{
                gridColumn: `${hoverCell.col} / span ${hoverCell.w}`,
                gridRow: `${hoverCell.row} / span ${hoverCell.h}`,
                border: `1px dashed ${SH_COLORS.accentBright}`,
                background: 'rgba(167,139,250,0.08)',
                pointerEvents: 'none', minWidth: 0, minHeight: 0,
              }} />
            )}
          </div>
        </div>

        {/* Inspector — floating overlay, does not affect grid layout */}
        {focusedId && (() => {
          const w = widgets.find((x) => x.id === focusedId);
          if (!w) return null;
          return (
            <div style={{
              position: 'absolute', top: 48, right: 12, width: 288, maxHeight: 'calc(100% - 80px)',
              zIndex: 30,
              borderLeft: `1px solid ${SH_COLORS.border}`, border: `1px solid ${SH_COLORS.border}`,
              background: SH_COLORS.bg, display: 'flex', flexDirection: 'column', minHeight: 0,
              boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            }}>
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${SH_COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: SH_COLORS.textFaint, letterSpacing: 1.5 }}>INSPECTOR</span>
                <span onClick={() => setFocusedId(null)} style={{ color: SH_COLORS.textFaint, cursor: 'pointer' }}>×</span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 12, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textMute, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Row label="ID" value={w.id} />
                <Row label="TYPE" value={(w.type as string).toUpperCase()} />
                <Row label="GRID" value={`${w.col},${w.row} · ${w.w}×${w.h}`} />
                <div>
                  <div style={{ marginBottom: 5, letterSpacing: 1.2 }}>SIGNALS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {w.signals.length === 0 && (
                      <span style={{ fontSize: 9, color: SH_COLORS.textFaint, fontStyle: 'italic' }}>
                        none — search below to add
                      </span>
                    )}
                    {w.signals.map((s: any) => {
                      const sig = catalog.resolve(s);
                      const effective = (sig && (w.signalColors?.[sig.id] ?? sig.color)) ?? '#a78bfa';
                      return (
                        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <SignalChip
                            sigId={s}
                            size="xs"
                            onRemove={() => patch(w.id, {
                              signals: w.signals.filter((x: any) => x !== s),
                              // Drop any orphaned color override for this signal.
                              signalColors: sig
                                ? Object.fromEntries(Object.entries(w.signalColors ?? {}).filter(([k]) => Number(k) !== sig.id))
                                : w.signalColors,
                            })}
                          />
                          {sig && (
                            <input
                              type="color"
                              value={effective}
                              onChange={(e) => patch(w.id, {
                                signalColors: { ...(w.signalColors ?? {}), [sig.id]: e.target.value },
                              })}
                              title={`Color for ${sig.name}`}
                              style={{
                                width: 18, height: 18, padding: 0, border: `1px solid ${SH_COLORS.border}`,
                                background: 'transparent', cursor: 'pointer',
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <InspectorSignalAdder
                    widget={w}
                    query={inspectorQuery}
                    onQueryChange={setInspectorQuery}
                    onAdd={(sid) => {
                      const multi = w.type === 'graph' || w.type === 'bar' || w.type === 'heatmap';
                      if (multi) {
                        if (w.signals.includes(sid)) return;
                        patch(w.id, { signals: [...w.signals, sid] });
                      } else {
                        patch(w.id, { signals: [sid] });
                      }
                      setInspectorQuery('');
                    }}
                  />
                </div>
                {w.type === 'graph' && (() => {
                  // Sample-status indicator: peek at the frames buffer for the
                  // widget's signals and find the largest sample_n across all
                  // returned buckets. sample_n > 1 means the server aggregated
                  // multiple raw samples into a bucket — zooming in further
                  // will reveal more detail. sample_n ≤ 1 means every visible
                  // point IS a raw sample (or empty bucket).
                  let maxSampleN = 0;
                  let totalSampleN = 0;
                  let bucketsSeen = 0;
                  for (const sig of w.signals ?? []) {
                    if (typeof sig !== 'number') continue;
                    const arr = frames?.series(sig) ?? [];
                    for (const f of arr) {
                      const n = f.sampleN ?? 1;
                      if (n > maxSampleN) maxSampleN = n;
                      totalSampleN += n;
                      bucketsSeen += 1;
                    }
                  }
                  const isAggregated = maxSampleN > 1;
                  const avgPerBucket = bucketsSeen > 0 ? totalSampleN / bucketsSeen : 0;
                  return (
                  <>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
                        <span>ZOOM</span>
                        <span style={{ color: SH_COLORS.textFaint }}>
                          drag · dbl-click resets
                        </span>
                      </div>
                      <button onClick={() => onZoom?.(null)} style={smallBtn()}>⤢ RESET ZOOM</button>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
                        <span>DATA</span>
                        <span style={{ color: isAggregated ? SH_COLORS.accentBright : SH_COLORS.textFaint }}>
                          {bucketsSeen === 0
                            ? '—'
                            : isAggregated
                              ? `AGGREGATED · avg ${avgPerBucket.toFixed(1)}/bucket`
                              : 'RAW'}
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: SH_COLORS.textFaint }}>
                        {isAggregated
                          ? 'Some samples merged. Zoom in to see more detail.'
                          : bucketsSeen === 0
                            ? 'No data in current window.'
                            : 'Every point is an actual recorded sample.'}
                      </div>
                    </div>
                    <div>
                      <div style={{ marginBottom: 5, letterSpacing: 1.2 }}>Y AXIS</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <SegBtn active={(w.yMode || 'auto') === 'auto'} onClick={() => patch(w.id, { yMode: 'auto' })}>AUTO</SegBtn>
                        <SegBtn active={w.yMode === 'fixed'} onClick={() => patch(w.id, { yMode: 'fixed' })}>FIXED</SegBtn>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
                        <span>MIN/MAX BAND</span>
                        <span style={{ color: w.showRange === false ? SH_COLORS.textFaint : SH_COLORS.accentBright }}>
                          {w.showRange === false ? 'OFF' : 'ON'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <SegBtn active={w.showRange !== false} onClick={() => patch(w.id, { showRange: true })}>ON</SegBtn>
                        <SegBtn active={w.showRange === false} onClick={() => patch(w.id, { showRange: false })}>OFF</SegBtn>
                      </div>
                    </div>
                    <div>
                      <div style={{ marginBottom: 5, letterSpacing: 1.2 }}>STYLE</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <SegBtn active={(w.graphStyle ?? graphStyle) === 'line'} onClick={() => patch(w.id, { graphStyle: 'line' })}>LINE</SegBtn>
                        <SegBtn active={(w.graphStyle ?? graphStyle) === 'dots'} onClick={() => patch(w.id, { graphStyle: 'dots' })}>DOTS</SegBtn>
                      </div>
                    </div>
                  </>
                  );
                })()}
                {w.type === 'gg' && <GgSourcePanel />}
                <div>
                  <div style={{ marginBottom: 6, letterSpacing: 1.2 }}>CURRENT VALUE</div>
                  {w.signals.slice(0, 6).map((sid: any) => <SignalReadout key={sid} sig={sid} t={t} />)}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <button onClick={() => {
                    const id = 'w' + Date.now().toString(36);
                    setWidgets((ws) => [...ws, { ...w, id, row: w.row + w.h }]);
                  }} style={smallBtn()}>⎘ DUPE</button>
                  <button onClick={() => remove(w.id)} style={{ ...smallBtn(), color: SH_COLORS.err, borderColor: 'rgba(242,87,87,0.3)' }}>✕ DELETE</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      <Timeline t={t} onChange={onT} durationSecs={durationSecs} mode={mode} compact />

      {pendingDrop && (
        <DropTypePopup
          onCancel={() => setPendingDrop(null)}
          onPick={(type) => {
            addWidget(type, pendingDrop.signalId);
            setPendingDrop(null);
          }}
        />
      )}

      {importState?.open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 110,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => {
            if (importState.done) setImportState(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              minWidth: 480, maxWidth: '90vw',
              background: SH_COLORS.bg,
              border: `1px solid ${SH_COLORS.border}`,
              boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
              fontFamily: '"JetBrains Mono", monospace',
              color: SH_COLORS.text,
            }}
          >
            <div style={{
              padding: '12px 16px',
              borderBottom: `1px solid ${SH_COLORS.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, letterSpacing: 1.5, color: SH_COLORS.textFaint }}>
                {importState.done
                  ? (importState.wasCancelled ? 'IMPORT CANCELLED' : 'IMPORT COMPLETE')
                  : 'IMPORTING…'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {!importState.done && (
                  <button
                    onClick={() => {
                      importCancelFlagRef.current = true;
                      // Kill the parser server-side; the in-flight fetch will
                      // resolve with error 'cancelled' once the child exits.
                      fetch('/api/import/cancel', { method: 'POST' }).catch(() => {});
                    }}
                    style={{
                      padding: '4px 10px',
                      background: 'transparent',
                      border: '1px solid #f87171',
                      color: '#f87171',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10, letterSpacing: 1.5, cursor: 'pointer',
                      borderRadius: 2,
                    }}
                    title="Stop the running parser and skip remaining files"
                  >■ CANCEL</button>
                )}
                {importState.done && (
                  <span
                    onClick={() => setImportState(null)}
                    style={{ color: SH_COLORS.textFaint, cursor: 'pointer', userSelect: 'none' }}
                  >×</span>
                )}
              </div>
            </div>

            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: SH_COLORS.text, fontFamily: '"Inter", system-ui, sans-serif' }}>
                {importState.done
                  ? 'Done.'
                  : <>Processing <strong>{importState.currentFile}</strong></>}
              </div>

              {/* Progress bar */}
              <div style={{
                height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${(Math.min(importState.index + (importState.done ? 1 : 0), importState.total) / importState.total) * 100}%`,
                  background: importState.failed > 0 && importState.done
                    ? '#e08a5a'
                    : SH_COLORS.accentBright,
                  transition: 'width 200ms ease',
                }} />
              </div>

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 11, color: SH_COLORS.textMute,
              }}>
                <span>
                  {Math.min(importState.index + (importState.done ? 1 : 0), importState.total)}
                  {' / '}
                  {importState.total} files
                </span>
                <span>
                  {importState.totalRows.toLocaleString()} rows
                </span>
              </div>

              <div style={{
                display: 'flex', gap: 12,
                fontSize: 10, color: SH_COLORS.textMute, letterSpacing: 1,
              }}>
                <span><span style={{ color: SH_COLORS.accentBright }}>{importState.succeeded}</span> PARSED</span>
                <span><span style={{ color: '#fbbf24' }}>{importState.skipped}</span> SKIPPED</span>
                <span><span style={{ color: '#f87171' }}>{importState.failed}</span> FAILED</span>
                {importState.cancelled > 0 && (
                  <span><span style={{ color: '#9ca3af' }}>{importState.cancelled}</span> CANCELLED</span>
                )}
              </div>

              {importState.skippedFiles.length > 0 && (
                <div style={{
                  padding: 10,
                  background: 'rgba(251,191,36,0.06)',
                  border: '1px solid rgba(251,191,36,0.25)',
                  borderRadius: 2,
                  fontSize: 10, color: '#fde68a', maxHeight: 140, overflow: 'auto',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {importState.skipped} skipped (already imported — tick "Re-decode" to overwrite):
                  </div>
                  {importState.skippedFiles.map((name, i) => (
                    <div key={i} style={{ marginTop: 2, wordBreak: 'break-word' }}>· {name}</div>
                  ))}
                </div>
              )}

              {importState.errors.length > 0 && (
                <div style={{
                  marginTop: 6, padding: 10,
                  background: 'rgba(242,87,87,0.08)',
                  border: '1px solid rgba(242,87,87,0.3)',
                  borderRadius: 2,
                  fontSize: 10, color: '#f4a8a8', maxHeight: 160, overflow: 'auto',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {importState.failed} failure{importState.failed === 1 ? '' : 's'}:
                  </div>
                  {importState.errors.map((err, i) => (
                    <div key={i} style={{ marginTop: 2, wordBreak: 'break-word' }}>· {err}</div>
                  ))}
                </div>
              )}

              {importState.done && (
                <button
                  onClick={() => setImportState(null)}
                  style={{
                    marginTop: 4, padding: '8px 14px',
                    background: 'transparent',
                    border: `1px solid ${SH_COLORS.border}`,
                    color: SH_COLORS.text,
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11, letterSpacing: 1.5, cursor: 'pointer',
                    alignSelf: 'flex-end',
                  }}
                >
                  CLOSE
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {dbcViewerOpen && <DbcViewerModal onClose={() => setDbcViewerOpen(false)} />}

      {nfrModalOpen && (
        <div
          onClick={() => setNfrModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              minWidth: 380, maxWidth: '90vw',
              background: SH_COLORS.bg,
              border: `1px solid ${SH_COLORS.border}`,
              boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
              fontFamily: '"JetBrains Mono", monospace',
              color: SH_COLORS.text,
            }}
          >
            <div style={{
              padding: '10px 14px',
              borderBottom: `1px solid ${SH_COLORS.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 10, letterSpacing: 1.5, color: SH_COLORS.textFaint }}>
                IMPORT .NFR
              </span>
              <span
                onClick={() => setNfrModalOpen(false)}
                style={{ color: SH_COLORS.textFaint, cursor: 'pointer', userSelect: 'none' }}
              >×</span>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{
                fontSize: 12, color: SH_COLORS.textMute, lineHeight: 1.6,
                fontFamily: '"Inter", system-ui, sans-serif',
                marginBottom: 4,
              }}>
                Pick one or more .nfr binaries, or point at a folder. Each
                file becomes a session in the database.
              </div>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                fontSize: 11, color: SH_COLORS.textMute, lineHeight: 1.5,
                fontFamily: '"Inter", system-ui, sans-serif',
                cursor: 'pointer',
                padding: '6px 0',
              }}>
                <input
                  type="checkbox"
                  checked={reparseOnImport}
                  onChange={(e) => setReparseOnImport(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>Re-decode with current DBC (overwrites existing rows)</span>
              </label>
              <button
                onClick={() => { setNfrModalOpen(false); nfrFileRef.current?.click(); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 6, padding: '16px 18px',
                  background: 'transparent',
                  border: `1px solid ${SH_COLORS.border}`,
                  borderRadius: 2,
                  color: SH_COLORS.text,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: 2 }}>SINGLE FILE</span>
                <span style={{
                  fontSize: 11, color: SH_COLORS.textMute,
                  fontFamily: '"Inter", system-ui, sans-serif',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}>
                  Pick one or more .nfr files
                </span>
              </button>
              <button
                onClick={() => { setNfrModalOpen(false); nfrFolderRef.current?.click(); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 6, padding: '16px 18px',
                  background: 'transparent',
                  border: `1px solid ${SH_COLORS.border}`,
                  borderRadius: 2,
                  color: SH_COLORS.text,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: 2 }}>FOLDER</span>
                <span style={{
                  fontSize: 11, color: SH_COLORS.textMute,
                  fontFamily: '"Inter", system-ui, sans-serif',
                  textTransform: 'none',
                  letterSpacing: 0,
                }}>
                  Pick a directory; every .nfr inside gets imported
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AvailableSignalsContext.Provider>
    </HoverProvider>
    </FramesCtx.Provider>
  );
}

function InspectorSignalAdder({
  widget,
  query,
  onQueryChange,
  onAdd,
}: {
  widget: any;
  query: string;
  onQueryChange: (q: string) => void;
  onAdd: (sid: any) => void;
}) {
  const catalog = useCatalog();
  const available = useAvailableSignals();
  const q = query.trim().toLowerCase();
  const matches = q
    ? catalog.ALL.filter(
        (s) =>
          (!available || available.has(s.id)) &&
          (s.name.toLowerCase().includes(q) ||
          s.groupName.toLowerCase().includes(q)),
      ).slice(0, 8)
    : [];

  return (
    <div>
      <input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search signals to add…"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '5px 8px',
          background: SH_COLORS.bgInner,
          border: `1px solid ${SH_COLORS.border}`,
          color: SH_COLORS.text,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 10,
          outline: 'none',
          borderRadius: 2,
        }}
      />
      {matches.length > 0 && (
        <div
          style={{
            marginTop: 4,
            border: `1px solid ${SH_COLORS.border}`,
            background: SH_COLORS.bgInner,
            maxHeight: 220,
            overflow: 'auto',
          }}
        >
          {matches.map((s) => {
            const already = widget.signals.includes(s.id);
            return (
              <div
                key={s.id}
                onClick={() => {
                  if (already) return;
                  onAdd(s.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  cursor: already ? 'default' : 'pointer',
                  opacity: already ? 0.4 : 1,
                  borderBottom: `1px solid ${SH_COLORS.border}`,
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  color: SH_COLORS.text,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: s.color,
                    boxShadow: `0 0 4px ${s.color}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>{s.groupName}</span>
                {already && <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>added</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegBtn({ active, onClick, children }: { active?: boolean; onClick?: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '4px 6px', border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : SH_COLORS.border}`,
      background: active ? 'rgba(167,139,250,0.18)' : 'transparent',
      color: active ? SH_COLORS.text : SH_COLORS.textMute,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 1, cursor: 'pointer',
    }}>{children}</button>
  );
}

/** Inspector panel for a g-g plot widget: pick which acceleration pair feeds
 *  the scatter. Persists to localStorage; all open g-g plots re-read on the
 *  resulting storage event so the switch is live. */
function GgSourcePanel() {
  const [src, setSrc] = useState<GgSource>(() => getGgSource());
  const choose = (next: GgSource) => { setGgSource(next); setSrc(next); };
  const [rawX, rawY] = ggSignalNames('raw');
  const [noGX, noGY] = ggSignalNames('no-g');
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
        <span>SOURCE</span>
        <span style={{ color: SH_COLORS.textFaint }}>signal pair</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <SegBtn active={src === 'raw'} onClick={() => choose('raw')}>WITH G</SegBtn>
        <SegBtn active={src === 'no-g'} onClick={() => choose('no-g')}>NO-G</SegBtn>
      </div>
      <div style={{ fontSize: 9, color: SH_COLORS.textFaint, lineHeight: 1.4 }}>
        {src === 'raw'
          ? <><code>{rawX}</code> · <code>{rawY}</code></>
          : <><code>{noGX}</code> · <code>{noGY}</code></>}
      </div>
    </div>
  );
}

// Dock-specific picker: favorites + collapsible groups
interface DockSignalPickerProps {
  selected: any;
  onPick: (id: any) => void;
  favorites: any[];
  onToggleFav: (id: any) => void;
  onCollapse?: () => void;
  activeOnly?: boolean;
}
function DockSignalPicker({ selected, onPick, favorites, onToggleFav, onCollapse, activeOnly = false }: DockSignalPickerProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const available = useAvailableSignals();
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (gid: string) => setCollapsed((c) => ({ ...c, [gid]: !c[gid] }));

  // The ACTIVE filter calls frames.latest(...) at render time. The picker
  // doesn't otherwise depend on frame data, so without a subscription it
  // would freeze on whatever was true at mount — the filter would never
  // pick up signals that started flowing later. Subscribe and force a
  // re-render at ~2 Hz while ACTIVE is on (more than enough for a sidebar).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!activeOnly || !frames) return;
    let scheduled = false;
    const unsubscribe = frames.subscribe(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        forceTick((n) => n + 1);
      }, 500);
    });
    return unsubscribe;
  }, [activeOnly, frames]);

  // ACTIVE filter semantics differ by mode:
  //   - Replay (available set is known): "has data anywhere in this session"
  //     = the available set itself. frames.latest() would only include signals
  //     already lazy-fetched into the window, which is too strict.
  //   - Live (no available set): "currently streaming" = frames.latest != null.
  const isActive = (id: number): boolean => {
    if (available) return available.has(id);
    return (frames?.latest(id) ?? null) !== null;
  };

  const matches = catalog.ALL.filter((s) => {
    if (available && !available.has(s.id)) return false;
    if (activeOnly && !isActive(s.id)) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q.toLowerCase()) || s.groupName.toLowerCase().includes(q.toLowerCase());
  });
  const totalAvailable = available ? catalog.ALL.filter((s) => available.has(s.id)).length : catalog.ALL.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 8, borderBottom: `1px solid ${SH_COLORS.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 1.5, color: SH_COLORS.textFaint }}>SIGNALS</div>
          {onCollapse && (
            <span onClick={onCollapse} title="Hide" style={{ cursor: 'pointer', color: SH_COLORS.textFaint, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, padding: '0 4px', userSelect: 'none' }}>«</span>
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <svg width="11" height="11" viewBox="0 0 11 11" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} fill="none" stroke={SH_COLORS.textMute} strokeWidth={1.5}><circle cx="4.5" cy="4.5" r="3"/><path d="M7 7l3 3"/></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 200+ signals…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 26px', background: SH_COLORS.bgInner, border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.text, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, outline: 'none' }} />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {favorites.length > 0 && !q && (
          <div>
            <div style={{ padding: '5px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 1.5, color: SH_COLORS.warn, background: 'rgba(232,166,72,0.05)' }}>
              ★ FAVORITES · {favorites.length}
            </div>
            {favorites.map((id) => {
              const s = catalog.resolve(id); if (!s) return null;
              if (available && !available.has(s.id)) return null;
              if (activeOnly && !isActive(s.id)) return null;
              return <SigRow key={id} s={s} selected={selected === id} fav onPick={onPick} onToggleFav={onToggleFav} />;
            })}
          </div>
        )}

        {catalog.GROUPS.map((g) => {
          const gSignals = matches.filter((s) => s.group === g.id);
          if (gSignals.length === 0) return null;
          const col = collapsed[g.id] && !q;
          return (
            <div key={g.id}>
              <div onClick={() => toggle(g.id)} style={{
                padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 1.5, color: SH_COLORS.textFaint,
                background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${SH_COLORS.border}`, userSelect: 'none',
              }}>
                <span style={{ transition: 'transform 120ms', transform: col ? 'rotate(-90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▾</span>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: g.color }} />
                <span style={{ flex: 1 }}>{g.name}</span>
                <span>{gSignals.length}</span>
              </div>
              {!col && gSignals.map((s) => (
                <SigRow key={s.id} s={s} selected={selected === s.id} fav={favorites.includes(s.id)} onPick={onPick} onToggleFav={onToggleFav} />
              ))}
            </div>
          );
        })}

        {matches.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textFaint }}>No matches</div>
        )}
      </div>

      <div style={{ padding: '4px 10px', borderTop: `1px solid ${SH_COLORS.border}`, fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: SH_COLORS.textFaint, letterSpacing: 0.5 }}>
        {matches.length} / {totalAvailable} · CLICK TO STAGE · ★ TO FAVORITE
      </div>
    </div>
  );
}

function SigRow({ s, selected, fav, onPick, onToggleFav }: { s: Signal; selected: boolean; fav?: boolean; onPick: (id: any) => void; onToggleFav: (id: any) => void }) {
  return (
    <div style={{
      padding: '5px 10px 5px 12px', display: 'flex', alignItems: 'center', gap: 8,
      cursor: 'grab', background: selected ? 'rgba(167,139,250,0.15)' : 'transparent',
      fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
      color: selected ? SH_COLORS.text : '#c8cbd0',
      borderLeft: selected ? `2px solid ${SH_COLORS.accentBright}` : '2px solid transparent',
    }}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('application/x-nfr-signal', String(s.id)); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={() => onPick(s.id)}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <span onClick={(e) => { e.stopPropagation(); onToggleFav(s.id); }}
        style={{ cursor: 'pointer', color: fav ? SH_COLORS.warn : SH_COLORS.textFaint, fontSize: 10, width: 10 }}>
        {fav ? '★' : '☆'}
      </span>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
      <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>
        {parseEnumMap(s.unit) ? '(enum)' : (s.unit || '—')}
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ letterSpacing: 1.2, color: SH_COLORS.textFaint }}>{label}</span>
      <span style={{ color: SH_COLORS.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function SignalReadout({ sig }: { sig: any; t: number }) {
  const catalog = useCatalog();
  const frames = useFrames();
  const s = catalog.resolve(sig);
  if (!s) return null;
  const latest = frames?.latest(s.id) ?? null;
  const v = latest ? latest.value : null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px dashed ${SH_COLORS.border}` }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
        <span style={{ color: SH_COLORS.text, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
      </span>
      <span style={{ color: SH_COLORS.text, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {(() => {
          if (v == null) return <>—</>;
          const r = fmtValOrEnum(v, s.unit);
          return (
            <>
              {r.text}
              {!r.isEnum && <span style={{ color: SH_COLORS.textFaint }}> {s.unit}</span>}
            </>
          );
        })()}
      </span>
    </div>
  );
}


interface DbcRow {
  frame_id: string;
  message_name: string;
  sender: string;
  signal_name: string;
  start_bit: number | null;
  size_bits: number | null;
  factor: number | null;
  offset: number | null;
  min: number | null;
  max: number | null;
  unit: string;
  cycle_ms: number | null;
  data_type: string;
}

function DbcViewerModal({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [rows, setRows] = useState<DbcRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dbc/current')
      .then(async (r) => {
        const body = await r.json().catch(() => ({} as any));
        if (cancelled) return;
        if (!r.ok || body?.error) {
          setErr(body?.error ?? `HTTP ${r.status}`);
          return;
        }
        setPath(body.path ?? null);
        setRows(Array.isArray(body.rows) ? body.rows : []);
      })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return rows;
    return rows.filter((r) =>
      r.signal_name.toLowerCase().includes(q) ||
      r.message_name.toLowerCase().includes(q) ||
      r.sender.toLowerCase().includes(q) ||
      r.unit.toLowerCase().includes(q) ||
      r.frame_id.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1100px, 92vw)', height: 'min(720px, 86vh)',
          background: SH_COLORS.bg,
          border: `1px solid ${SH_COLORS.border}`,
          boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          fontFamily: '"JetBrains Mono", monospace',
          color: SH_COLORS.text,
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}
      >
        <div style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${SH_COLORS.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <span style={{ fontSize: 10, letterSpacing: 1.5, color: SH_COLORS.textFaint }}>
            DBC · {rows ? `${rows.length} signals` : 'loading…'}
          </span>
          <span
            onClick={onClose}
            style={{ color: SH_COLORS.textFaint, cursor: 'pointer', userSelect: 'none' }}
          >×</span>
        </div>
        <div style={{
          padding: '8px 14px', borderBottom: `1px solid ${SH_COLORS.border}`,
          display: 'flex', alignItems: 'center', gap: 10, fontSize: 10,
        }}>
          <span style={{ color: SH_COLORS.textFaint }}>PATH</span>
          <span style={{ color: SH_COLORS.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {path ?? '—'}
          </span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter signal/message/sender/unit"
            style={{
              fontFamily: 'inherit', fontSize: 10,
              background: SH_COLORS.bgElev,
              border: `1px solid ${SH_COLORS.border}`,
              color: SH_COLORS.text,
              padding: '4px 8px', width: 280,
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {err ? (
            <div style={{ padding: 16, color: '#f87171', fontSize: 11 }}>{err}</div>
          ) : !rows ? (
            <div style={{ padding: 16, color: SH_COLORS.textFaint, fontSize: 11 }}>LOADING…</div>
          ) : (
            <table style={{
              width: '100%', borderCollapse: 'collapse', fontSize: 10,
            }}>
              <thead style={{ position: 'sticky', top: 0, background: SH_COLORS.bg }}>
                <tr style={{ color: SH_COLORS.textFaint, textAlign: 'left' }}>
                  {['FRAME', 'MESSAGE', 'SENDER', 'SIGNAL', 'BIT', 'LEN', 'FACTOR', 'OFFSET', 'MIN', 'MAX', 'UNIT', 'CYCLE', 'TYPE'].map((h) => (
                    <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${SH_COLORS.border}`, fontWeight: 500, letterSpacing: 1 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.frame_id}-${r.signal_name}-${i}`} style={{ color: SH_COLORS.textMute }}>
                    <td style={dbcCell()}>{r.frame_id}</td>
                    <td style={dbcCell()}>{r.message_name}</td>
                    <td style={dbcCell()}>{r.sender}</td>
                    <td style={{ ...dbcCell(), color: SH_COLORS.text }}>{r.signal_name}</td>
                    <td style={dbcCell()}>{r.start_bit ?? ''}</td>
                    <td style={dbcCell()}>{r.size_bits ?? ''}</td>
                    <td style={dbcCell()}>{r.factor ?? ''}</td>
                    <td style={dbcCell()}>{r.offset ?? ''}</td>
                    <td style={dbcCell()}>{r.min ?? ''}</td>
                    <td style={dbcCell()}>{r.max ?? ''}</td>
                    <td style={dbcCell()}>{r.unit}</td>
                    <td style={dbcCell()}>{r.cycle_ms ?? ''}</td>
                    <td style={dbcCell()}>{r.data_type}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={13} style={{ padding: 16, color: SH_COLORS.textFaint, fontSize: 11 }}>
                    no rows match filter
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function dbcCell(): React.CSSProperties {
  return {
    padding: '4px 8px',
    borderBottom: `1px solid rgba(255,255,255,0.04)`,
    whiteSpace: 'nowrap',
  };
}

function smallBtn(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.textMute,
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}
