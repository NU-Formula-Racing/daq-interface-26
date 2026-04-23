// Direction 3: BENCH
// Floating signal palette + freeform widget canvas. Drag signal from palette
// onto empty canvas to create a widget, or drop on an existing widget to add.

function BenchDirection({ t, mode, onMode, onT, duration, density, graphStyle }) {
  const [widgets, setWidgets] = React.useState([
    { id: 'b1', type: 'graph', signals: ['Inverter_RPM', 'Motor_Temperature'], window: 0.08, x: 12, y: 12, w: 380, h: 200 },
    { id: 'b2', type: 'gauge', signals: ['HV_Battery_SOC'], x: 408, y: 12, w: 180, h: 200 },
    { id: 'b3', type: 'numeric', signals: ['Vehicle_Speed'], x: 604, y: 12, w: 180, h: 95 },
    { id: 'b4', type: 'numeric', signals: ['Inverter_Torque'], x: 604, y: 117, w: 180, h: 95 },
    { id: 'b5', type: 'heatmap', signals: ['Tire_Temp_FL_Inner','Tire_Temp_FL_Middle','Tire_Temp_FL_Outer','Tire_Temp_FR_Inner','Tire_Temp_FR_Middle','Tire_Temp_FR_Outer','Tire_Temp_RL_Inner','Tire_Temp_RL_Middle','Tire_Temp_RL_Outer','Tire_Temp_RR_Inner','Tire_Temp_RR_Middle','Tire_Temp_RR_Outer'], x: 12, y: 228, w: 372, h: 240 },
    { id: 'b6', type: 'graph', signals: ['Accel_Lateral', 'Accel_Longitudinal'], window: 0.08, x: 400, y: 228, w: 384, h: 240 },
  ]);
  const [dragSig, setDragSig] = React.useState(null); // {id, x, y} during drag
  const [hoverWidget, setHoverWidget] = React.useState(null);
  const canvasRef = React.useRef(null);
  const [paletteOpen, setPaletteOpen] = React.useState(true);

  const patch = (id, next) => setWidgets((ws) => ws.map((x) => x.id === id ? { ...x, ...next } : x));
  const remove = (id) => setWidgets((ws) => ws.filter((x) => x.id !== id));

  // Start signal drag from palette
  const startSignalDrag = (sigId, e) => {
    e.preventDefault();
    setDragSig({ id: sigId, x: e.clientX, y: e.clientY });
    const move = (ev) => setDragSig({ id: sigId, x: ev.clientX, y: ev.clientY });
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      // drop
      const canvasRect = canvasRef.current.getBoundingClientRect();
      const relX = ev.clientX - canvasRect.left;
      const relY = ev.clientY - canvasRect.top;
      const hit = widgets.slice().reverse().find((w) => relX >= w.x && relX <= w.x + w.w && relY >= w.y && relY <= w.y + w.h);
      if (hit) {
        const multi = hit.type === 'graph' || hit.type === 'bar' || hit.type === 'heatmap';
        if (multi) {
          if (!hit.signals.includes(sigId)) patch(hit.id, { signals: [...hit.signals, sigId] });
        } else {
          patch(hit.id, { signals: [sigId] });
        }
      } else if (relX > 0 && relY > 0 && relX < canvasRect.width && relY < canvasRect.height) {
        // create a graph widget
        setWidgets((ws) => [...ws, { id: 'b' + Date.now(), type: 'graph', signals: [sigId], window: 0.08, x: Math.max(8, relX - 180), y: Math.max(8, relY - 80), w: 360, h: 180 }]);
      }
      setDragSig(null);
      setHoverWidget(null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  // Track hover widget during drag for highlight
  React.useEffect(() => {
    if (!dragSig || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const relX = dragSig.x - rect.left, relY = dragSig.y - rect.top;
    const hit = widgets.slice().reverse().find((w) => relX >= w.x && relX <= w.x + w.w && relY >= w.y && relY <= w.y + w.h);
    setHoverWidget(hit ? hit.id : null);
  }, [dragSig, widgets]);

  // Move widget
  const startWidgetDrag = (w, e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
    const move = (ev) => patch(w.id, { x: ox + (ev.clientX - sx), y: oy + (ev.clientY - sy) });
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  // Resize widget
  const startResize = (w, e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = w.w, oh = w.h;
    const move = (ev) => patch(w.id, { w: Math.max(160, ow + (ev.clientX - sx)), h: Math.max(80, oh + (ev.clientY - sy)) });
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <TopBar mode={mode} onMode={onMode} title="NFR · DAQ / BENCH" compact right={
        <>
          <button onClick={() => setPaletteOpen((o) => !o)} style={smallBtn()}>{paletteOpen ? '◧' : '◨'} PALETTE</button>
          <button style={smallBtn()}>↓ EXPORT</button>
        </>
      } />

      <div style={{ flex: 1, display: 'flex', position: 'relative', minHeight: 0 }}>
        {/* Freeform canvas */}
        <div ref={canvasRef} style={{
          flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden',
          backgroundImage: `radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
        }}>
          {widgets.map((w) => (
            <div key={w.id} style={{
              position: 'absolute', left: w.x, top: w.y, width: w.w, height: w.h,
              outline: hoverWidget === w.id ? `2px solid ${SH_COLORS.accentBright}` : 'none',
              boxShadow: hoverWidget === w.id ? `0 0 20px rgba(167,139,250,0.35)` : 'none',
              transition: 'box-shadow 120ms',
            }}>
              <WidgetShell widget={w} t={t} density={density} graphStyle={graphStyle}
                onChange={(next) => patch(w.id, next)}
                onRemove={() => remove(w.id)}
                draggable
                onDragStart={(e) => startWidgetDrag(w, e)} />
              {/* Resize handle */}
              <div onPointerDown={(e) => startResize(w, e)} style={{
                position: 'absolute', right: 0, bottom: 0, width: 12, height: 12,
                cursor: 'nwse-resize', background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%)',
              }} />
            </div>
          ))}
          {/* Empty canvas hint */}
          {widgets.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SH_COLORS.textFaint, fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}>
              Drag a signal from the palette onto the canvas →
            </div>
          )}
        </div>

        {/* Floating palette (right-docked) */}
        {paletteOpen && (
          <div style={{ width: 260, borderLeft: `1px solid ${SH_COLORS.border}`, display: 'flex', flexDirection: 'column', minHeight: 0, background: SH_COLORS.bg }}>
            <div style={{ padding: '6px 10px', borderBottom: `1px solid ${SH_COLORS.border}`, fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 1.5, color: SH_COLORS.textFaint, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: SH_COLORS.accentBright }}>◆</span> PALETTE · DRAG TO CANVAS
            </div>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <DraggableSignalPicker onStartDrag={startSignalDrag} />
            </div>
          </div>
        )}

        {/* Drag ghost */}
        {dragSig && (() => {
          const s = window.SIGNALS.byId(dragSig.id);
          return (
            <div style={{
              position: 'fixed', left: dragSig.x + 10, top: dragSig.y + 10, zIndex: 999, pointerEvents: 'none',
              padding: '6px 10px', background: SH_COLORS.bgInner, border: `1px solid ${SH_COLORS.accentBright}`,
              fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: SH_COLORS.text,
              boxShadow: `0 6px 20px rgba(0,0,0,0.5), 0 0 12px ${SH_COLORS.accentBright}66`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: s?.color }} />
              {s?.name}
            </div>
          );
        })()}
      </div>

      <Timeline t={t} onChange={onT} duration={duration} mode={mode} compact />
    </div>
  );
}

// Palette variant where each row starts a drag on pointerdown (not click).
function DraggableSignalPicker({ onStartDrag }) {
  const [q, setQ] = React.useState('');
  const [group, setGroup] = React.useState('all');
  const matches = window.SIGNALS.ALL.filter((s) => {
    if (group !== 'all' && s.group !== group) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q.toLowerCase());
  });
  const byGroup = {};
  for (const s of matches) {
    if (!byGroup[s.group]) byGroup[s.group] = { name: s.groupName, signals: [] };
    byGroup[s.group].signals.push(s);
  }
  const groupOrder = window.SIGNALS.GROUPS.map((g) => g.id).filter((g) => byGroup[g]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 8, borderBottom: `1px solid ${SH_COLORS.border}` }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search signals…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', background: SH_COLORS.bgInner, border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.text, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, outline: 'none' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          <GroupPill2 active={group === 'all'} onClick={() => setGroup('all')} label="ALL" />
          {window.SIGNALS.GROUPS.map((g) => (
            <GroupPill2 key={g.id} color={g.color} active={group === g.id}
              onClick={() => setGroup(group === g.id ? 'all' : g.id)} label={g.name.split(' ')[0]} />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {groupOrder.map((gid) => (
          <div key={gid}>
            <div style={{ padding: '5px 10px', fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 1.5, color: SH_COLORS.textFaint, background: 'rgba(255,255,255,0.02)' }}>
              {byGroup[gid].name}
            </div>
            {byGroup[gid].signals.map((s) => (
              <div key={s.id}
                onPointerDown={(e) => onStartDrag(s.id, e)}
                style={{ padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: '#c8cbd0', userSelect: 'none' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(167,139,250,0.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>{s.unit || '—'}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupPill2({ label, color, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 6px', background: active ? 'rgba(167,139,250,0.18)' : 'transparent',
      border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : SH_COLORS.border}`,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 0.8,
      color: active ? SH_COLORS.text : SH_COLORS.textMute, cursor: 'pointer', userSelect: 'none',
    }}>
      {color && <span style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />}
      {label}
    </div>
  );
}

Object.assign(window, { BenchDirection });
