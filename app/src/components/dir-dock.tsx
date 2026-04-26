// Direction 1 v2: DOCK — full-bleed prototype.
// Widgets live in a 12-col grid; draggable + resizable. Layout persists to localStorage.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../api/client.ts';
import type { Session } from '../api/types.ts';
import { useCatalog } from './SignalsProvider.tsx';
import { COLORS as SH_COLORS } from './colors.ts';
import {
  SignalChip,
  Timeline,
  TopBar,
  WidgetShell,
  WidgetIcon,
  WIDGET_TYPES,
} from './widgets.tsx';
import type { Signal } from '../signals/catalog.ts';
import type { FramesStore } from '../hooks/useLiveFrames.ts';
import { FramesCtx, useFrames } from './FramesContext.tsx';

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
  duration: number;
  density: string;
  graphStyle: 'line' | 'area' | 'step';
  frames?: FramesStore;
}

export function DockDirection({ t, mode, onMode, onT, duration, density, graphStyle, frames, exportHref }: DockDirectionProps) {
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

  // Persist
  useEffect(() => {
    try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(widgets)); } catch {}
  }, [widgets]);
  useEffect(() => {
    try { localStorage.setItem('nfr-favs', JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  const COLS = 12;
  const patch = (id: string, next: any) => setWidgets((ws) => ws.map((w) => w.id === id ? (typeof next === 'function' ? next(w) : { ...w, ...next }) : w));
  const remove = (id: string) => { setWidgets((ws) => ws.filter((w) => w.id !== id)); if (focusedId === id) setFocusedId(null); };
  const resetLayout = () => setWidgets(DEFAULT_LAYOUT);

  const addWidget = (type: string) => {
    const sig = selectedSignal || 'Inverter_RPM';
    const id = 'w' + Date.now().toString(36);
    const lastRow = Math.max(0, ...widgets.map((w) => w.row + w.h - 1));
    const multiTypes = ['graph', 'bar', 'heatmap'];
    setWidgets((ws) => [...ws, {
      id, type,
      signals: multiTypes.includes(type) ? [sig] : [sig],
      window: 0.05, col: 1, row: lastRow + 1,
      w: type === 'numeric' ? 3 : type === 'gauge' ? 4 : 6, h: 3,
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

  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const nfrFileRef = useRef<HTMLInputElement>(null);
  const nfrFolderRef = useRef<HTMLInputElement>(null);
  const [dbcStatus, setDbcStatus] = useState<string>('');
  const [nfrStatus, setNfrStatus] = useState<string>('');
  const [nfrModalOpen, setNfrModalOpen] = useState(false);
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

  const onPickNfr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    e.target.value = '';
    if (!fileList || fileList.length === 0) return;

    // Filter to .nfr files only (case-insensitive). Folder picks include
    // every file inside; user only wants the binary logs.
    const all = Array.from(fileList);
    const nfrs = all.filter((f) => /\.nfr$/i.test(f.name));
    if (nfrs.length === 0) {
      setNfrStatus('No .nfr files found in selection');
      setTimeout(() => setNfrStatus(''), 4000);
      return;
    }

    let succeeded = 0;
    let failed = 0;
    let totalRows = 0;
    for (let i = 0; i < nfrs.length; i++) {
      const f = nfrs[i];
      setNfrStatus(`Importing ${i + 1}/${nfrs.length} · ${f.name}`);
      try {
        const buf = await f.arrayBuffer();
        const res = await fetch('/api/import/nfr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': f.name,
          },
          body: buf,
        });
        if (!res.ok) {
          failed++;
          continue;
        }
        const body = (await res.json()) as { row_count?: number };
        succeeded++;
        totalRows += body.row_count ?? 0;
      } catch {
        failed++;
      }
    }
    setNfrStatus(
      `Imported ${succeeded}/${nfrs.length} · ${totalRows.toLocaleString()} rows${failed > 0 ? ` · ${failed} failed` : ''}`,
    );
    setTimeout(() => setNfrStatus(''), 8000);
  };

  return (
    <FramesCtx.Provider value={frames ?? null}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <TopBar
        mode={mode}
        onMode={onMode}
        title="NFR · DAQ"
        compact
        sessionSlot={<SessionPicker />}
        nav={
          <button
            onClick={() => navigate('/settings')}
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
            <button onClick={() => fileRef.current?.click()} style={smallBtn()} title="Upload a new DBC CSV">↑ DBC</button>
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
            <DockSignalPicker
              selected={selectedSignal}
              onPick={(s) => setSelectedSignal(s === selectedSignal ? null : s)}
              favorites={favorites}
              onToggleFav={toggleFav}
              onCollapse={() => setRailOpen(false)}
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
          <div ref={gridRef} style={{
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
                <div key={w.id} style={{
                  gridColumn: `${preview.col} / span ${preview.w}`,
                  gridRow: `${preview.row} / span ${preview.h}`,
                  minWidth: 0, minHeight: 0, position: 'relative',
                  outline: focusedId === w.id ? `1px solid ${SH_COLORS.accentBright}` : 'none',
                  outlineOffset: -1,
                  opacity: isDragging ? 0.85 : 1,
                  zIndex: isDragging ? 10 : 1,
                  transition: isDragging ? 'none' : 'opacity 120ms',
                }}
                  onClick={() => setFocusedId(w.id)}
                >
                  <WidgetShell widget={w} t={t} mode={mode}
                    density={density} graphStyle={graphStyle}
                    onChange={(next) => patch(w.id, next)}
                    onRemove={() => remove(w.id)}
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
                    {w.signals.map((s: any) => (
                      <SignalChip
                        key={s}
                        sigId={s}
                        size="xs"
                        onRemove={() => patch(w.id, { signals: w.signals.filter((x: any) => x !== s) })}
                      />
                    ))}
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
                {w.type === 'graph' && (
                  <>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
                        <span>WINDOW</span>
                        <span style={{ color: SH_COLORS.text }}>
                          {w.window >= 1 ? 'ALL' : `${Math.round((w.window || 0.05) * 3600)}s`}
                        </span>
                      </div>
                      <input type="range" min={0.01} max={1} step={0.01} value={Math.min(1, w.window || 0.05)}
                        onChange={(e) => patch(w.id, { window: +e.target.value })}
                        style={{ width: '100%', accentColor: SH_COLORS.accentBright }} />
                      <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                        <SegBtn active={(w.window || 0.05) <= 0.02} onClick={() => patch(w.id, { window: 0.02 })}>60s</SegBtn>
                        <SegBtn active={Math.abs((w.window || 0.05) - 0.05) < 0.001} onClick={() => patch(w.id, { window: 0.05 })}>3m</SegBtn>
                        <SegBtn active={Math.abs((w.window || 0.05) - 0.17) < 0.02} onClick={() => patch(w.id, { window: 0.17 })}>10m</SegBtn>
                        <SegBtn active={w.window >= 1} onClick={() => patch(w.id, { window: 1 })}>ALL</SegBtn>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
                        <span>ZOOM</span>
                        <span style={{ color: w.zoom ? SH_COLORS.accentBright : SH_COLORS.textFaint }}>
                          {w.zoom ? `${Math.round(w.zoom[0]*3600)}s → ${Math.round(w.zoom[1]*3600)}s` : 'OFF'}
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: SH_COLORS.textFaint, marginBottom: 4 }}>Drag on plot to zoom · dbl-click to reset</div>
                      {w.zoom && (
                        <button onClick={() => patch(w.id, { zoom: null })} style={smallBtn()}>⤢ RESET ZOOM</button>
                      )}
                    </div>
                    <div>
                      <div style={{ marginBottom: 5, letterSpacing: 1.2 }}>Y AXIS</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <SegBtn active={(w.yMode || 'auto') === 'auto'} onClick={() => patch(w.id, { yMode: 'auto' })}>AUTO</SegBtn>
                        <SegBtn active={w.yMode === 'fixed'} onClick={() => patch(w.id, { yMode: 'fixed' })}>FIXED</SegBtn>
                      </div>
                    </div>
                  </>
                )}
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

      <Timeline t={t} onChange={onT} duration={duration} mode={mode} compact />

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
  const q = query.trim().toLowerCase();
  const matches = q
    ? catalog.ALL.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.groupName.toLowerCase().includes(q),
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

// Dock-specific picker: favorites + collapsible groups
interface DockSignalPickerProps {
  selected: any;
  onPick: (id: any) => void;
  favorites: any[];
  onToggleFav: (id: any) => void;
  onCollapse?: () => void;
}
function DockSignalPicker({ selected, onPick, favorites, onToggleFav, onCollapse }: DockSignalPickerProps) {
  const catalog = useCatalog();
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (gid: string) => setCollapsed((c) => ({ ...c, [gid]: !c[gid] }));

  const matches = catalog.ALL.filter((s) =>
    !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.groupName.toLowerCase().includes(q.toLowerCase())
  );

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
        {matches.length} / {catalog.ALL.length} · CLICK TO STAGE · ★ TO FAVORITE
      </div>
    </div>
  );
}

function SigRow({ s, selected, fav, onPick, onToggleFav }: { s: Signal; selected: boolean; fav?: boolean; onPick: (id: any) => void; onToggleFav: (id: any) => void }) {
  return (
    <div style={{
      padding: '5px 10px 5px 12px', display: 'flex', alignItems: 'center', gap: 8,
      cursor: 'pointer', background: selected ? 'rgba(167,139,250,0.15)' : 'transparent',
      fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
      color: selected ? SH_COLORS.text : '#c8cbd0',
      borderLeft: selected ? `2px solid ${SH_COLORS.accentBright}` : '2px solid transparent',
    }}
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
      <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>{s.unit || '—'}</span>
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
      <span style={{ color: SH_COLORS.text, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{v != null ? v.toFixed(1) : '—'} <span style={{ color: SH_COLORS.textFaint }}>{s.unit}</span></span>
    </div>
  );
}

function SessionPicker() {
  const navigate = useNavigate();
  const params = useParams();
  const currentId = params.id ?? null;

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    if (!open) return;
    apiGet<Session[]>('/api/sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [open]);

  // Re-fetch when navigation lands on a new session id so the dropdown
  // reflects the freshest data when reopened.
  useEffect(() => {
    if (open) {
      apiGet<Session[]>('/api/sessions').then(setSessions).catch(() => {});
    }
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = sessions?.find((s) => s.id === currentId);
  const label = currentId
    ? current
      ? `${new Date(current.started_at).toLocaleDateString()} · ${currentId.slice(0, 8)}`
      : currentId.slice(0, 8)
    : 'Select session';

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          ...smallBtn(),
          color: SH_COLORS.text,
          padding: '4px 10px',
        }}
      >
        {label} ▾
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
          />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            width: 360, maxHeight: 380, overflow: 'auto',
            background: SH_COLORS.bg,
            border: `1px solid ${SH_COLORS.border}`,
            zIndex: 51,
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
          }}>
            {sessions === null ? (
              <div style={{ padding: 12, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textFaint }}>
                Loading…
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: 12, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textFaint }}>
                No sessions
              </div>
            ) : (
              sessions.map((s) => {
                const active = s.id === currentId;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      navigate(`/sessions/${s.id}`);
                      setOpen(false);
                    }}
                    style={{
                      padding: '8px 12px',
                      borderBottom: `1px solid ${SH_COLORS.border}`,
                      cursor: 'pointer',
                      background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 10,
                      color: SH_COLORS.text,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>{new Date(s.started_at).toLocaleString()}</span>
                      <span style={{
                        color: s.source === 'live' ? SH_COLORS.ok : SH_COLORS.accentBright,
                        fontSize: 9, letterSpacing: 1, textTransform: 'uppercase',
                      }}>
                        {s.source}
                      </span>
                    </div>
                    <div style={{
                      marginTop: 2,
                      color: SH_COLORS.textMute,
                      fontSize: 9,
                      display: 'flex', gap: 8,
                    }}>
                      <span>{s.id.slice(0, 8)}</span>
                      {s.track && <span>· {s.track}</span>}
                      {s.driver && <span>· {s.driver}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function smallBtn(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.textMute,
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}
