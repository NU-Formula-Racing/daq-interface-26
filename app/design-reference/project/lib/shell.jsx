// Shared UI bits: SignalPicker, SignalChip, Timeline, TopBar, WidgetShell.
// All three directions (Dock/Console/Bench) compose these.

const SH_COLORS = W_COLORS;

// ────────────────────────────────────────────────────────────
// SignalChip — group color dot + name
// ────────────────────────────────────────────────────────────
function SignalChip({ sigId, onRemove, onClick, active, size = 'sm' }) {
  const sig = window.SIGNALS.byId(sigId);
  if (!sig) return null;
  const pad = size === 'xs' ? '2px 6px' : '3px 8px';
  const fs = size === 'xs' ? 10 : 11;
  return (
    <div onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad,
      background: active ? 'rgba(167,139,250,0.18)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 2, fontFamily: '"JetBrains Mono", monospace', fontSize: fs,
      color: SH_COLORS.text, cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sig.color, boxShadow: `0 0 4px ${sig.color}` }} />
      <span>{sig.name}</span>
      {onRemove && (
        <span onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{ color: SH_COLORS.textFaint, cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '0 2px' }}>×</span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// SignalPicker — searchable list with group filter
// ────────────────────────────────────────────────────────────
function SignalPicker({ onPick, selected = [], multi = false, compact = false, filter = '', height = '100%', onFilterChange }) {
  const [localFilter, setLocalFilter] = React.useState(filter);
  const [groupFilter, setGroupFilter] = React.useState('all');
  const q = (onFilterChange ? filter : localFilter).toLowerCase();

  const matches = window.SIGNALS.ALL.filter((s) => {
    if (groupFilter !== 'all' && s.group !== groupFilter) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.groupName.toLowerCase().includes(q);
  });

  // Group matches for rendering
  const byGroup = {};
  for (const s of matches) {
    if (!byGroup[s.group]) byGroup[s.group] = { name: s.groupName, signals: [] };
    byGroup[s.group].signals.push(s);
  }
  const groupOrder = window.SIGNALS.GROUPS.map((g) => g.id).filter((g) => byGroup[g]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, background: SH_COLORS.bg, minHeight: 0 }}>
      {/* Search */}
      <div style={{ padding: compact ? 8 : 10, borderBottom: `1px solid ${SH_COLORS.border}` }}>
        <div style={{ position: 'relative' }}>
          <svg width="11" height="11" viewBox="0 0 11 11" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} fill="none" stroke={SH_COLORS.textMute} strokeWidth={1.5}><circle cx="4.5" cy="4.5" r="3"/><path d="M7 7l3 3"/></svg>
          <input
            value={onFilterChange ? filter : localFilter}
            onChange={(e) => onFilterChange ? onFilterChange(e.target.value) : setLocalFilter(e.target.value)}
            placeholder="Search 200+ signals…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 8px 6px 26px', background: SH_COLORS.bgInner,
              border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.text,
              fontFamily: '"JetBrains Mono", monospace', fontSize: 11, outline: 'none', borderRadius: 2,
            }}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          <GroupPill active={groupFilter === 'all'} onClick={() => setGroupFilter('all')} label="ALL" />
          {window.SIGNALS.GROUPS.map((g) => (
            <GroupPill key={g.id} color={g.color} active={groupFilter === g.id}
              onClick={() => setGroupFilter(groupFilter === g.id ? 'all' : g.id)} label={g.name} />
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {groupOrder.map((gid) => {
          const g = byGroup[gid];
          return (
            <div key={gid}>
              <div style={{
                padding: '6px 10px', fontFamily: '"JetBrains Mono", monospace',
                fontSize: 9, letterSpacing: 1.5, color: SH_COLORS.textFaint,
                background: 'rgba(255,255,255,0.02)', position: 'sticky', top: 0, zIndex: 1,
                borderBottom: `1px solid ${SH_COLORS.border}`,
              }}>
                {g.name} · {g.signals.length}
              </div>
              {g.signals.map((s) => {
                const sel = selected.includes(s.id);
                return (
                  <div key={s.id} onClick={() => onPick && onPick(s.id)}
                    style={{
                      padding: '5px 10px 5px 12px', display: 'flex', alignItems: 'center', gap: 8,
                      cursor: 'pointer', background: sel ? 'rgba(167,139,250,0.14)' : 'transparent',
                      fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
                      color: sel ? SH_COLORS.text : '#c8cbd0',
                      borderLeft: sel ? `2px solid ${SH_COLORS.accentBright}` : '2px solid transparent',
                    }}
                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                    <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>{s.unit || '—'}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {matches.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: SH_COLORS.textFaint, fontFamily: '"JetBrains Mono", monospace', fontSize: 11 }}>
            No matches
          </div>
        )}
      </div>

      {/* Footer count */}
      <div style={{ padding: '4px 10px', borderTop: `1px solid ${SH_COLORS.border}`, fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: SH_COLORS.textFaint, letterSpacing: 0.5 }}>
        {matches.length} / {window.SIGNALS.ALL.length} SIGNALS
      </div>
    </div>
  );
}

function GroupPill({ label, color, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 6px', background: active ? 'rgba(167,139,250,0.18)' : 'transparent',
      border: `1px solid ${active ? 'rgba(167,139,250,0.5)' : SH_COLORS.border}`, borderRadius: 2,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 9, letterSpacing: 0.8,
      color: active ? SH_COLORS.text : SH_COLORS.textMute, cursor: 'pointer', userSelect: 'none',
    }}>
      {color && <span style={{ width: 4, height: 4, borderRadius: '50%', background: color }} />}
      {label}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Timeline — used by all three for Replay scrubbing, Live for pause/scrub-back
// ────────────────────────────────────────────────────────────
function Timeline({ t, onChange, duration = 1, mode, compact }) {
  const ref = React.useRef(null);
  const [hoverX, setHoverX] = React.useState(null);
  const [hoverT, setHoverT] = React.useState(0);

  const onDown = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const move = (ev) => {
      const x = ((ev.clientX || ev.touches?.[0]?.clientX) - rect.left) / rect.width;
      onChange(Math.max(0, Math.min(1, x)) * duration);
    };
    move(e);
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    setHoverX(x);
    setHoverT((x / rect.width) * duration);
  };

  const pct = (t / duration) * 100;

  // Event markers (pseudo laps / flags) — deterministic
  const markers = React.useMemo(() => {
    const out = [];
    for (let i = 1; i <= 6; i++) out.push({ pos: i / 7, label: `L${i}`, kind: 'lap' });
    out.push({ pos: 0.28, label: 'FAULT', kind: 'warn' });
    out.push({ pos: 0.62, label: 'PIT', kind: 'info' });
    return out;
  }, []);

  const fmt = (tt) => {
    const m = Math.floor(tt * 60) % 60;
    const s = Math.floor(tt * 3600) % 60;
    const ms = Math.floor((tt * 3600 * 1000) % 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  return (
    <div style={{
      padding: compact ? '6px 12px' : '8px 16px', background: SH_COLORS.bg,
      borderTop: `1px solid ${SH_COLORS.border}`, display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: mode === 'live' ? SH_COLORS.ok : SH_COLORS.textMute, letterSpacing: 0.5, minWidth: 90, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: mode === 'live' ? SH_COLORS.ok : SH_COLORS.accentBright, boxShadow: `0 0 6px ${mode === 'live' ? SH_COLORS.ok : SH_COLORS.accentBright}` }} />
        {mode === 'live' ? 'LIVE' : 'REPLAY'} · {fmt(t)}
      </div>

      <div
        ref={ref}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerLeave={() => setHoverX(null)}
        style={{ flex: 1, position: 'relative', height: 28, cursor: 'pointer', userSelect: 'none' }}
      >
        {/* Track */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: 'rgba(255,255,255,0.08)', transform: 'translateY(-50%)' }} />
        {/* Played portion */}
        <div style={{ position: 'absolute', left: 0, width: `${pct}%`, top: '50%', height: 2, background: SH_COLORS.accentBright, transform: 'translateY(-50%)', boxShadow: `0 0 4px ${SH_COLORS.accentBright}` }} />
        {/* Markers */}
        {markers.map((m, i) => (
          <div key={i} style={{ position: 'absolute', left: `${m.pos * 100}%`, top: 3, bottom: 3, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <div style={{ width: 1, height: '100%', background: m.kind === 'warn' ? SH_COLORS.err : m.kind === 'info' ? SH_COLORS.warn : 'rgba(255,255,255,0.2)' }} />
            <span style={{ position: 'absolute', top: -12, fontFamily: '"JetBrains Mono", monospace', fontSize: 8, color: m.kind === 'warn' ? SH_COLORS.err : m.kind === 'info' ? SH_COLORS.warn : SH_COLORS.textFaint, letterSpacing: 0.5 }}>{m.label}</span>
          </div>
        ))}
        {/* Playhead */}
        <div style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: 2, background: SH_COLORS.accentBright, transform: 'translateX(-50%)', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: '50%', left: '50%', width: 10, height: 10, borderRadius: '50%', background: SH_COLORS.accentBright, transform: 'translate(-50%,-50%)', boxShadow: `0 0 8px ${SH_COLORS.accentBright}` }} />
        </div>
        {/* Hover tooltip */}
        {hoverX !== null && (
          <div style={{ position: 'absolute', left: hoverX, bottom: '100%', transform: 'translateX(-50%)', marginBottom: 4, background: SH_COLORS.bgInner, border: `1px solid ${SH_COLORS.border}`, padding: '2px 6px', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.text, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {fmt(hoverT)}
          </div>
        )}
      </div>

      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textFaint }}>
        {fmt(duration)}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// WidgetShell — header bar w/ signal chips + type selector + remove
// ────────────────────────────────────────────────────────────
const WIDGET_TYPES = [
  { id: 'graph', label: 'GRAPH', icon: 'graph' },
  { id: 'numeric', label: 'NUMERIC', icon: 'num' },
  { id: 'gauge', label: 'GAUGE', icon: 'gauge' },
  { id: 'bar', label: 'BAR', icon: 'bar' },
  { id: 'heatmap', label: 'HEATMAP', icon: 'heat' },
];

function WidgetIcon({ kind, size = 10 }) {
  const s = size;
  const common = { width: s, height: s, stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' };
  switch (kind) {
    case 'graph': return <svg {...common} viewBox="0 0 10 10"><polyline points="0,8 2,4 4,6 6,2 8,5 10,3"/></svg>;
    case 'num': return <svg {...common} viewBox="0 0 10 10" fill="currentColor" stroke="none"><rect x="1" y="3" width="8" height="4" rx="0.5"/></svg>;
    case 'gauge': return <svg {...common} viewBox="0 0 10 10"><path d="M2 8 A3 3 0 0 1 8 8"/><line x1="5" y1="8" x2="7" y2="4"/></svg>;
    case 'bar': return <svg {...common} viewBox="0 0 10 10"><rect x="1" y="4" width="8" height="1.5"/><rect x="1" y="7" width="5" height="1.5"/></svg>;
    case 'heat': return <svg {...common} viewBox="0 0 10 10" fill="currentColor" stroke="none"><rect x="1" y="1" width="3" height="3"/><rect x="5" y="1" width="3" height="3" opacity="0.6"/><rect x="1" y="5" width="3" height="3" opacity="0.4"/><rect x="5" y="5" width="3" height="3" opacity="0.8"/></svg>;
    default: return null;
  }
}

function WidgetShell({ widget, t, mode = 'replay', onChange, onRemove, onAssignSignal, density = 'comfortable', graphStyle = 'line', children, draggable, onDragStart, onHeaderClick }) {
  const [typeOpen, setTypeOpen] = React.useState(false);
  const [sigOpen, setSigOpen] = React.useState(false);
  const compact = density === 'compact';

  const renderBody = () => {
    const common = { t, compact };
    switch (widget.type) {
      case 'graph': return <GraphWidget signals={widget.signals} t={t} mode={mode} window={widget.window || 0.05} style={graphStyle} compact={compact} zoom={widget.zoom || null} onZoom={(z) => onChange({ ...widget, zoom: z })} />;
      case 'numeric': return <NumericWidget signal={widget.signals[0]} t={t} compact={compact} />;
      case 'gauge': return <GaugeWidget signal={widget.signals[0]} t={t} />;
      case 'bar': return <BarWidget signals={widget.signals} t={t} />;
      case 'heatmap': return <HeatmapWidget signals={widget.signals} t={t} />;
      default: return <EmptySlot label="Pick a type" />;
    }
  };

  const multi = widget.type === 'graph' || widget.type === 'bar' || widget.type === 'heatmap';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0,
      background: SH_COLORS.bg, border: `1px solid ${SH_COLORS.border}`,
      position: 'relative',
    }}>
      {/* Header */}
      <div
        onMouseDown={draggable ? onDragStart : undefined}
        onClick={onHeaderClick}
        style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: compact ? '4px 6px' : '6px 8px',
        background: 'rgba(255,255,255,0.02)', borderBottom: `1px solid ${SH_COLORS.border}`,
        fontFamily: '"JetBrains Mono", monospace', fontSize: 10, minHeight: compact ? 24 : 28,
        cursor: draggable ? 'move' : 'default',
      }}>
        {/* Type selector */}
        <div style={{ position: 'relative' }}>
          <button onClick={(e) => { e.stopPropagation(); setTypeOpen((o) => !o); setSigOpen(false); }} style={headerBtn()}>
            <WidgetIcon kind={WIDGET_TYPES.find((x) => x.id === widget.type)?.icon} />
            <span>{widget.type.toUpperCase()}</span>
            <span style={{ opacity: 0.5 }}>▾</span>
          </button>
          {typeOpen && (
            <div style={dropdown()}>
              {WIDGET_TYPES.map((wt) => (
                <div key={wt.id} onClick={(e) => { e.stopPropagation(); onChange({ ...widget, type: wt.id, signals: wt.id === 'numeric' || wt.id === 'gauge' ? widget.signals.slice(0, 1) : widget.signals }); setTypeOpen(false); }}
                  style={dropItem(wt.id === widget.type)}>
                  <WidgetIcon kind={wt.icon} />
                  <span>{wt.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 12, background: SH_COLORS.border }} />

        {/* Signal chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, overflow: 'hidden', flexWrap: 'nowrap' }}>
          {widget.signals.length === 0 && (
            <button onClick={(e) => { e.stopPropagation(); setSigOpen(true); setTypeOpen(false); }} style={{ ...headerBtn(), color: SH_COLORS.textMute }}>
              + signal
            </button>
          )}
          {widget.signals.slice(0, compact ? 2 : 4).map((sid) => (
            <SignalChip key={sid} sigId={sid} size="xs"
              onRemove={() => onChange({ ...widget, signals: widget.signals.filter((x) => x !== sid) })} />
          ))}
          {widget.signals.length > (compact ? 2 : 4) && (
            <span style={{ color: SH_COLORS.textMute, fontSize: 10 }}>+{widget.signals.length - (compact ? 2 : 4)}</span>
          )}
          {widget.signals.length > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setSigOpen(true); setTypeOpen(false); }}
              style={{ ...headerBtn(), padding: '2px 5px', color: SH_COLORS.textMute }} title={multi ? 'Add signal' : 'Change signal'}>
              {multi ? '+' : '↔'}
            </button>
          )}
        </div>

        {onRemove && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ ...headerBtn(), color: SH_COLORS.textFaint, padding: '2px 5px' }} title="Remove">×</button>
        )}

        {/* Signal picker popover */}
        {sigOpen && (
          <>
            <div onClick={() => setSigOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
            <div style={{ position: 'absolute', top: '100%', left: 0, width: 280, maxWidth: '90vw', height: 360, zIndex: 51, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', border: `1px solid ${SH_COLORS.border}`, background: SH_COLORS.bg }}>
              <SignalPicker
                selected={widget.signals}
                onPick={(sid) => {
                  if (multi) {
                    if (widget.signals.includes(sid)) return;
                    onChange({ ...widget, signals: [...widget.signals, sid] });
                  } else {
                    onChange({ ...widget, signals: [sid] });
                    setSigOpen(false);
                  }
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {children || renderBody()}
      </div>
    </div>
  );
}

function headerBtn() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px',
    background: 'transparent', border: `1px solid transparent`, color: SH_COLORS.text,
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, cursor: 'pointer', letterSpacing: 0.5,
  };
}
function dropdown() {
  return {
    position: 'absolute', top: '100%', left: 0, marginTop: 2, background: SH_COLORS.bgInner,
    border: `1px solid ${SH_COLORS.border}`, minWidth: 120, zIndex: 52,
    boxShadow: '0 6px 20px rgba(0,0,0,0.5)', padding: 2,
  };
}
function dropItem(active) {
  return {
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
    background: active ? 'rgba(167,139,250,0.18)' : 'transparent',
    color: active ? SH_COLORS.text : SH_COLORS.textMute, cursor: 'pointer',
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: 0.5,
  };
}

// ────────────────────────────────────────────────────────────
// TopBar — live/replay toggle, session picker, download
// ────────────────────────────────────────────────────────────
function TopBar({ mode, onMode, title = 'NFR · DAQ', session = 'Session #17', date = '2026-04-21', right, compact }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: compact ? '6px 12px' : '8px 16px',
      background: SH_COLORS.bg, borderBottom: `1px solid ${SH_COLORS.border}`,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 11, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <NFRMark />
        <span style={{ color: SH_COLORS.text, letterSpacing: 1.2, fontWeight: 600 }}>{title}</span>
      </div>

      <div style={{ display: 'flex', border: `1px solid ${SH_COLORS.border}`, borderRadius: 2, overflow: 'hidden' }}>
        {['live', 'replay'].map((m) => (
          <button key={m} onClick={() => onMode(m)}
            style={{
              padding: '4px 12px', border: 'none',
              background: mode === m ? (m === 'live' ? 'rgba(126,201,143,0.16)' : 'rgba(167,139,250,0.18)') : 'transparent',
              color: mode === m ? (m === 'live' ? SH_COLORS.ok : SH_COLORS.accentBright) : SH_COLORS.textMute,
              fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: 1, cursor: 'pointer',
              textTransform: 'uppercase',
            }}>
            {m === 'live' && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: SH_COLORS.ok, marginRight: 6, verticalAlign: 'middle', boxShadow: mode === 'live' ? `0 0 6px ${SH_COLORS.ok}` : 'none' }} />}
            {m}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <span style={{ color: SH_COLORS.textMute, fontSize: 10 }}>{date}</span>
      <span style={{ color: SH_COLORS.text, fontSize: 10, padding: '3px 8px', border: `1px solid ${SH_COLORS.border}`, borderRadius: 2 }}>{session} ▾</span>
      {right}
    </div>
  );
}

function NFRMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20">
      <rect width="20" height="20" fill="#4E2A84"/>
      <path d="M5 14 L5 6 L7 6 L12 11 L12 6 L14 6 L14 14 L12 14 L7 9 L7 14 Z" fill="#fff"/>
    </svg>
  );
}

Object.assign(window, { SignalPicker, SignalChip, Timeline, WidgetShell, TopBar, WIDGET_TYPES, WidgetIcon, NFRMark, SH_COLORS });
