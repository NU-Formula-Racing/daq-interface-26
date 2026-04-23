// Direction 1 v2: DOCK — full-bleed prototype.
// Widgets live in a 12-col grid; draggable + resizable. Layout persists to localStorage.

const DOCK_STORAGE_KEY = 'nfr-dock-layout-v2';

const DEFAULT_LAYOUT = [
  { id: 'w1', type: 'graph',   signals: ['Inverter_RPM', 'APPS1_Throttle'], window: 0.05, col: 1, row: 1, w: 8, h: 3 },
  { id: 'w2', type: 'gauge',   signals: ['HV_Battery_SOC'],                              col: 9, row: 1, w: 4, h: 3 },
  { id: 'w3', type: 'graph',   signals: ['Motor_Temperature', 'IGBT_Temperature', 'Coolant_Temp_Out'], window: 0.08, col: 1, row: 4, w: 5, h: 3 },
  { id: 'w4', type: 'numeric', signals: ['Vehicle_Speed'],                               col: 6, row: 4, w: 2, h: 3 },
  { id: 'w5', type: 'numeric', signals: ['Inverter_Torque'],                             col: 8, row: 4, w: 2, h: 3 },
  { id: 'w6', type: 'bar',     signals: ['Tire_Pressure_FL','Tire_Pressure_FR','Tire_Pressure_RL','Tire_Pressure_RR'], col: 10, row: 4, w: 3, h: 3 },
  { id: 'w7', type: 'heatmap', signals: ['Tire_Temp_FL_Inner','Tire_Temp_FL_Middle','Tire_Temp_FL_Outer','Tire_Temp_FR_Inner','Tire_Temp_FR_Middle','Tire_Temp_FR_Outer','Tire_Temp_RL_Inner','Tire_Temp_RL_Middle','Tire_Temp_RL_Outer','Tire_Temp_RR_Inner','Tire_Temp_RR_Middle','Tire_Temp_RR_Outer'], col: 1, row: 7, w: 6, h: 4 },
  { id: 'w8', type: 'graph',   signals: ['Brake_Pressure_Front', 'Brake_Pressure_Rear'], window: 0.05, col: 7, row: 7, w: 6, h: 4 },
];

function loadLayout() {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) {}
  return DEFAULT_LAYOUT;
}

function DockDirection({ t, mode, onMode, onT, duration, density, graphStyle }) {
  const [widgets, setWidgets] = React.useState(loadLayout);
  const [selectedSignal, setSelectedSignal] = React.useState(null);
  const [focusedId, setFocusedId] = React.useState(null);
  const [favorites, setFavorites] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('nfr-favs') || '[]'); } catch { return []; }
  });
  const [railW, setRailW] = React.useState(() => {
    const v = parseInt(localStorage.getItem('nfr-rail-w') || '260', 10);
    return isNaN(v) ? 260 : v;
  });
  const [railOpen, setRailOpen] = React.useState(() => localStorage.getItem('nfr-rail-open') !== '0');
  React.useEffect(() => { localStorage.setItem('nfr-rail-w', String(railW)); }, [railW]);
  React.useEffect(() => { localStorage.setItem('nfr-rail-open', railOpen ? '1' : '0'); }, [railOpen]);
  const startRailResize = (e) => {
    e.preventDefault();
    const sx = e.clientX, ow = railW;
    const mv = (ev) => setRailW(Math.max(180, Math.min(520, ow + (ev.clientX - sx))));
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  };
  const gridRef = React.useRef(null);
  const [drag, setDrag] = React.useState(null); // {id, kind:'move'|'resize', origin, startPos}
  const [hoverCell, setHoverCell] = React.useState(null);

  // Persist
  React.useEffect(() => {
    try { localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(widgets)); } catch {}
  }, [widgets]);
  React.useEffect(() => {
    try { localStorage.setItem('nfr-favs', JSON.stringify(favorites)); } catch {}
  }, [favorites]);

  const COLS = 12;
  const patch = (id, next) => setWidgets((ws) => ws.map((w) => w.id === id ? (typeof next === 'function' ? next(w) : { ...w, ...next }) : w));
  const remove = (id) => { setWidgets((ws) => ws.filter((w) => w.id !== id)); if (focusedId === id) setFocusedId(null); };
  const resetLayout = () => setWidgets(DEFAULT_LAYOUT);

  const addWidget = (type) => {
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

  const startMove = (w, e) => {
    e.preventDefault(); e.stopPropagation();
    const { cw, ch } = cellSize();
    const origin = { x: e.clientX, y: e.clientY, col: w.col, row: w.row };
    setDrag({ id: w.id, kind: 'move', origin, cw, ch });
    const move = (ev) => {
      const dc = Math.round((ev.clientX - origin.x) / cw);
      const dr = Math.round((ev.clientY - origin.y) / ch);
      const nc = Math.max(1, Math.min(COLS - w.w + 1, origin.col + dc));
      const nr = Math.max(1, origin.row + dr);
      setHoverCell({ col: nc, row: nr, w: w.w, h: w.h });
    };
    const up = (ev) => {
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

  const startResize = (w, e) => {
    e.preventDefault(); e.stopPropagation();
    const { cw, ch } = cellSize();
    const origin = { x: e.clientX, y: e.clientY, w: w.w, h: w.h };
    setDrag({ id: w.id, kind: 'resize', origin, cw, ch });
    const move = (ev) => {
      const dw = Math.round((ev.clientX - origin.x) / cw);
      const dh = Math.round((ev.clientY - origin.y) / ch);
      const nw = Math.max(2, Math.min(COLS - w.col + 1, origin.w + dw));
      const nh = Math.max(2, origin.h + dh);
      setHoverCell({ col: w.col, row: w.row, w: nw, h: nh });
    };
    const up = (ev) => {
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

  const toggleFav = (id) => setFavorites((f) => f.includes(id) ? f.filter((x) => x !== id) : [...f, id]);

  const maxRow = Math.max(12, ...widgets.map((w) => w.row + w.h - 1), (hoverCell?.row || 0) + (hoverCell?.h || 0) - 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <TopBar mode={mode} onMode={onMode} title="NFR · DAQ" compact right={
        <>
          <button onClick={resetLayout} style={smallBtn()}>⟲ RESET</button>
          <button style={smallBtn()}>↓ EXPORT</button>
        </>
      } />

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
                <Row label="TYPE" value={w.type.toUpperCase()} />
                <Row label="GRID" value={`${w.col},${w.row} · ${w.w}×${w.h}`} />
                <div>
                  <div style={{ marginBottom: 5, letterSpacing: 1.2 }}>SIGNALS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {w.signals.map((s) => (
                      <SignalChip key={s} sigId={s} size="xs" onRemove={() => patch(w.id, { ...w, signals: w.signals.filter((x) => x !== s) })} />
                    ))}
                  </div>
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
                  {w.signals.slice(0, 6).map((sid) => <SignalReadout key={sid} sig={sid} t={t} />)}
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
    </div>
  );
}

function SegBtn({ active, onClick, children }) {
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
function DockSignalPicker({ selected, onPick, favorites, onToggleFav, onCollapse }) {
  const [q, setQ] = React.useState('');
  const [collapsed, setCollapsed] = React.useState({});
  const toggle = (gid) => setCollapsed((c) => ({ ...c, [gid]: !c[gid] }));

  const matches = window.SIGNALS.ALL.filter((s) =>
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
              const s = window.SIGNALS.byId(id); if (!s) return null;
              return <SigRow key={id} s={s} selected={selected === id} fav onPick={onPick} onToggleFav={onToggleFav} />;
            })}
          </div>
        )}

        {window.SIGNALS.GROUPS.map((g) => {
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
        {matches.length} / {window.SIGNALS.ALL.length} · CLICK TO STAGE · ★ TO FAVORITE
      </div>
    </div>
  );
}

function SigRow({ s, selected, fav, onPick, onToggleFav }) {
  return (
    <div style={{
      padding: '5px 10px 5px 12px', display: 'flex', alignItems: 'center', gap: 8,
      cursor: 'pointer', background: selected ? 'rgba(167,139,250,0.15)' : 'transparent',
      fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
      color: selected ? SH_COLORS.text : '#c8cbd0',
      borderLeft: selected ? `2px solid ${SH_COLORS.accentBright}` : '2px solid transparent',
    }}
      onClick={() => onPick(s.id)}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
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

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ letterSpacing: 1.2, color: SH_COLORS.textFaint }}>{label}</span>
      <span style={{ color: SH_COLORS.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function SignalReadout({ sig, t }) {
  const s = window.SIGNALS.byId(sig);
  if (!s) return null;
  const d = window.SIGNALS.sampleSignal(s, Math.max(0, t - 0.02), t, 2);
  const v = d[d.length - 1];
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px dashed ${SH_COLORS.border}` }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
        <span style={{ color: SH_COLORS.text, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
      </span>
      <span style={{ color: SH_COLORS.text, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{v.toFixed(1)} <span style={{ color: SH_COLORS.textFaint }}>{s.unit}</span></span>
    </div>
  );
}

function smallBtn() {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.textMute,
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}

Object.assign(window, { DockDirection });
