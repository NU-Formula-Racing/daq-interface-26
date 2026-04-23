// Direction 2: CONSOLE
// Logic-analyzer / oscilloscope style. Stacked full-width tracks with a shared
// time cursor. Command bar at top for adding a track w/ signal via type-ahead.
// Each track is a WidgetShell with its own type; default graph.

function ConsoleDirection({ t, mode, onMode, onT, duration, density, graphStyle }) {
  const [tracks, setTracks] = React.useState([
    { id: 't1', type: 'graph', signals: ['Inverter_RPM'], window: 0.1 },
    { id: 't2', type: 'graph', signals: ['APPS1_Throttle', 'Brake_Pressure_Front'], window: 0.1 },
    { id: 't3', type: 'graph', signals: ['Motor_Temperature', 'IGBT_Temperature', 'Coolant_Temp_Out'], window: 0.1 },
    { id: 't4', type: 'graph', signals: ['Accel_Lateral', 'Accel_Longitudinal'], window: 0.1 },
    { id: 't5', type: 'numeric', signals: ['HV_Battery_SOC'] },
    { id: 't6', type: 'graph', signals: ['Wheel_Speed_FL', 'Wheel_Speed_FR', 'Wheel_Speed_RL', 'Wheel_Speed_RR'], window: 0.1 },
  ]);
  const [cmd, setCmd] = React.useState('');
  const [cmdFocus, setCmdFocus] = React.useState(false);
  const [cursorT, setCursorT] = React.useState(null);

  const patch = (id, next) => setTracks((ts) => ts.map((x) => x.id === id ? (typeof next === 'function' ? next(x) : next) : x));
  const remove = (id) => setTracks((ts) => ts.filter((x) => x.id !== id));

  const matches = cmd
    ? window.SIGNALS.ALL.filter((s) => s.name.toLowerCase().includes(cmd.toLowerCase())).slice(0, 8)
    : [];

  const addTrack = (sig) => {
    setTracks((ts) => [...ts, { id: 't' + Date.now(), type: 'graph', signals: [sig], window: 0.1 }]);
    setCmd('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <TopBar mode={mode} onMode={onMode} title="NFR · DAQ / CONSOLE" compact right={
        <button style={smallBtn()}>↓ EXPORT</button>
      } />

      {/* Command bar */}
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${SH_COLORS.border}`, background: SH_COLORS.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.accentBright, letterSpacing: 1 }}>»</span>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onFocus={() => setCmdFocus(true)}
            onBlur={() => setTimeout(() => setCmdFocus(false), 120)}
            placeholder="add signal, e.g. Motor_Temperature …"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '5px 8px', background: SH_COLORS.bgInner,
              border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.text,
              fontFamily: '"JetBrains Mono", monospace', fontSize: 11, outline: 'none',
            }}
          />
          {cmdFocus && matches.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: SH_COLORS.bgInner, border: `1px solid ${SH_COLORS.border}`, zIndex: 20, maxHeight: 280, overflow: 'auto' }}>
              {matches.map((s) => (
                <div key={s.id} onMouseDown={() => addTrack(s.id)}
                  style={{ padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(167,139,250,0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color }} />
                  <span style={{ color: SH_COLORS.text }}>{s.name}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: SH_COLORS.textFaint, fontSize: 9, letterSpacing: 0.8 }}>{s.groupName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => addTrack('Vehicle_Speed')} style={smallBtn()}>+ TRACK</button>
          <button onClick={() => setTracks([])} style={smallBtn()}>CLEAR</button>
        </div>
      </div>

      {/* Track stack w/ shared cursor overlay */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, position: 'relative' }}
        onMouseLeave={() => setCursorT(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left - 140) / (rect.width - 140 - 8); // approx track plot width ratio
          setCursorT(Math.max(0, Math.min(1, x)));
        }}>
        {tracks.map((tr, i) => (
          <div key={tr.id} style={{ display: 'flex', alignItems: 'stretch', borderBottom: `1px solid ${SH_COLORS.border}`, minHeight: density === 'compact' ? 74 : 110 }}>
            {/* Left gutter: track index + signals + type */}
            <div style={{ width: 140, flexShrink: 0, borderRight: `1px solid ${SH_COLORS.border}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(255,255,255,0.01)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: SH_COLORS.textFaint, width: 18 }}>{String(i + 1).padStart(2, '0')}</span>
                <TypeMini type={tr.type} onChange={(type) => patch(tr.id, { ...tr, type })} />
                <span style={{ flex: 1 }} />
                <span onClick={() => remove(tr.id)} style={{ color: SH_COLORS.textFaint, cursor: 'pointer', fontSize: 11 }}>×</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                {tr.signals.map((s) => (
                  <SignalChip key={s} sigId={s} size="xs" onRemove={() => patch(tr.id, { ...tr, signals: tr.signals.filter((x) => x !== s) })} />
                ))}
                <AddSignalBtn onPick={(s) => patch(tr.id, { ...tr, signals: [...tr.signals, s] })} />
              </div>
            </div>
            {/* Plot */}
            <div style={{ flex: 1, minWidth: 0, padding: 4 }}>
              {tr.type === 'graph' && <GraphWidget signals={tr.signals} t={t} window={tr.window || 0.1} style={graphStyle} compact={density === 'compact'} showAxes={true} />}
              {tr.type === 'numeric' && <NumericWidget signal={tr.signals[0]} t={t} compact />}
              {tr.type === 'gauge' && <GaugeWidget signal={tr.signals[0]} t={t} />}
              {tr.type === 'bar' && <BarWidget signals={tr.signals} t={t} />}
              {tr.type === 'heatmap' && <HeatmapWidget signals={tr.signals} t={t} />}
            </div>
            {/* Live readouts */}
            <div style={{ width: 110, flexShrink: 0, borderLeft: `1px solid ${SH_COLORS.border}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2, background: 'rgba(255,255,255,0.01)', justifyContent: 'center' }}>
              {tr.signals.map((sid) => {
                const s = window.SIGNALS.byId(sid); if (!s) return null;
                const d = window.SIGNALS.sampleSignal(s, Math.max(0, t - 0.02), t, 2);
                return (
                  <div key={sid} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: s.color, alignSelf: 'center' }} />
                    <span style={{ color: SH_COLORS.text, fontVariantNumeric: 'tabular-nums' }}>{d[1].toFixed(1)}</span>
                    <span style={{ color: SH_COLORS.textFaint, fontSize: 8 }}>{s.unit}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {/* Shared cursor overlay */}
        {cursorT !== null && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(140px + (100% - 250px) * ${cursorT})`, width: 1, background: SH_COLORS.accentBright, opacity: 0.5, pointerEvents: 'none' }} />
        )}
      </div>

      <Timeline t={t} onChange={onT} duration={duration} mode={mode} compact />
    </div>
  );
}

function TypeMini({ type, onChange }) {
  const [open, setOpen] = React.useState(false);
  const cur = WIDGET_TYPES.find((x) => x.id === type);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...smallBtn(), padding: '2px 4px', color: SH_COLORS.text }}>
        <WidgetIcon kind={cur?.icon} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, background: SH_COLORS.bgInner, border: `1px solid ${SH_COLORS.border}`, zIndex: 6, padding: 2 }}>
            {WIDGET_TYPES.map((wt) => (
              <div key={wt.id} onClick={() => { onChange(wt.id); setOpen(false); }}
                style={{ padding: '4px 8px', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', color: wt.id === type ? SH_COLORS.text : SH_COLORS.textMute, fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }}>
                <WidgetIcon kind={wt.icon} /> {wt.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AddSignalBtn({ onPick }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(true)} style={{ ...smallBtn(), width: '100%', fontSize: 9, padding: '2px 4px' }}>+ SIGNAL</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 4, width: 260, height: 340, zIndex: 41, border: `1px solid ${SH_COLORS.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
            <SignalPicker onPick={(s) => { onPick(s); setOpen(false); }} />
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { ConsoleDirection });
