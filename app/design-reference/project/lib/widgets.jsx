// Shared widget renderers. Pure presentational — read from current time/data.
// Each widget: <GraphWidget/>, <NumericWidget/>, <GaugeWidget/>, <BarWidget/>, <HeatmapWidget/>

// JetBrains-inspired softer palette — warm grays over pure black.
const W_COLORS = {
  bg: '#2b2d30',         // panel bg (JetBrains "dark gray")
  bgInner: '#1e1f22',    // plot / input bg
  bgElev: '#3c3f41',     // hovered rows, chips
  grid: 'rgba(255,255,255,0.05)',
  gridMid: 'rgba(255,255,255,0.09)',
  axis: 'rgba(220,221,222,0.45)',
  text: '#dfe1e5',
  textMute: '#9da0a8',
  textFaint: '#6f7278',
  border: 'rgba(255,255,255,0.09)',
  accent: '#7c6fde',
  accentBright: '#a78bfa',
  warn: '#f0a55c',
  err: '#e06c6c',
  ok: '#7ec98f',
};

// ────────────────────────────────────────────────────────────
// Graph — oscilloscope-style line/area/step
//
// Behavior:
// - Window is decoupled from playhead t. Widget has its own visible [winStart..winEnd].
// - In 'live' mode, the window auto-tracks: winEnd = t, winStart = t - winSize.
// - In 'replay' mode, the window holds steady. Scrubbing t just moves a cursor
//   within the plot — the graph does NOT shrink. If t drifts outside the window,
//   the window pans (keeps size) to keep t in view.
// - User can drag horizontally on the plot to ZOOM to that region (persisted
//   to widget.zoom = [a, b]). Double-click resets.
// - Always shows current/cursor values on the right.
// ────────────────────────────────────────────────────────────
function GraphWidget({
  signals = [], t, window: win = 0.05, style = 'line',
  density = 'normal', compact = false, showAxes = true, showCursor = true, height,
  zoom = null, onZoom, mode = 'replay',
}) {
  const wrap = React.useRef(null);
  const svgRef = React.useRef(null);
  const [size, setSize] = React.useState({ w: 320, h: 160 });
  const [hoverFrac, setHoverFrac] = React.useState(null); // 0..1 within plot
  const [zoomDrag, setZoomDrag] = React.useState(null); // { a, b } fractions

  React.useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // Determine window [t0, t1]
  let t0, t1;
  if (zoom && zoom.length === 2) {
    t0 = Math.max(0, zoom[0]);
    t1 = Math.min(1, zoom[1]);
    if (t1 - t0 < 1e-4) { t0 = 0; t1 = 1; }
  } else if (mode === 'live') {
    t1 = t;
    t0 = Math.max(0, t - win);
    if (t1 - t0 < win * 0.5) { t0 = 0; t1 = Math.max(win, t1); }
  } else {
    // Replay: stable window. Anchor to floor(t/win)*win so scrubbing doesn't shrink.
    const w = win;
    t0 = Math.max(0, Math.floor(t / w) * w);
    t1 = Math.min(1, t0 + w);
    if (t1 >= 1) { t1 = 1; t0 = Math.max(0, t1 - w); }
  }

  const wrapPadding = compact ? 8 : 10;
  const padL = compact ? 32 : 40, padR = 8, padT = compact ? 18 : 22, padB = compact ? 16 : 20;
  const plotW = Math.max(10, size.w - padL - padR);
  const plotH = Math.max(10, size.h - padT - padB);
  const N = Math.max(40, Math.min(800, Math.round(plotW * 1.2)));

  // Sample signals
  const series = signals.map((sid) => {
    const sig = window.SIGNALS.byId(sid);
    if (!sig) return null;
    const data = window.SIGNALS.sampleSignal(sig, t0, t1, N);
    return { sig, data };
  }).filter(Boolean);

  // Domain: use union of signal ranges if multiple, else signal's own min/max
  let dMin = Infinity, dMax = -Infinity;
  if (series.length === 0) { dMin = 0; dMax = 1; }
  else if (series.length === 1) { dMin = series[0].sig.min; dMax = series[0].sig.max; }
  else {
    for (const s of series) { dMin = Math.min(dMin, s.sig.min); dMax = Math.max(dMax, s.sig.max); }
  }
  const dSpan = dMax - dMin || 1;

  const y = (v) => padT + plotH - ((v - dMin) / dSpan) * plotH;
  const x = (i) => padL + (i / (N - 1)) * plotW;
  const xAtFrac = (f) => padL + f * plotW;

  const yTicks = 4;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => dMin + (dSpan * i) / yTicks);
  const xTicks = compact ? 4 : 6;

  const fmtTime = (tt) => {
    const m = Math.floor(tt * 60) % 60;
    const s = Math.floor(tt * 3600) % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const fmtTimeMs = (tt) => {
    const m = Math.floor(tt * 60) % 60;
    const s = Math.floor(tt * 3600) % 60;
    const ms = Math.floor((tt * 3600 * 1000) % 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  const fmtVal = (v) => {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
  };

  const pathFor = (data) => {
    if (style === 'step') {
      let d = `M ${x(0)} ${y(data[0])}`;
      for (let i = 1; i < data.length; i++) {
        d += ` L ${x(i)} ${y(data[i - 1])} L ${x(i)} ${y(data[i])}`;
      }
      return d;
    }
    let d = `M ${x(0)} ${y(data[0])}`;
    for (let i = 1; i < data.length; i++) d += ` L ${x(i)} ${y(data[i])}`;
    return d;
  };
  const areaPathFor = (data) => {
    let d = `M ${x(0)} ${padT + plotH}`;
    d += ` L ${x(0)} ${y(data[0])}`;
    for (let i = 1; i < data.length; i++) d += ` L ${x(i)} ${y(data[i])}`;
    d += ` L ${x(N - 1)} ${padT + plotH} Z`;
    return d;
  };

  // ── Pointer handlers for hover + zoom-to-region ──
  const fracFromEvent = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left - padL;
    return Math.max(0, Math.min(1, px / plotW));
  };
  const onPointerMove = (e) => {
    if (!svgRef.current) return;
    const f = fracFromEvent(e);
    setHoverFrac(f);
    if (zoomDrag) setZoomDrag({ a: zoomDrag.a, b: f });
  };
  const onPointerLeave = () => { if (!zoomDrag) setHoverFrac(null); };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const f = fracFromEvent(e);
    const startF = f;
    let endF = f;
    const mv = (ev) => { endF = fracFromEvent(ev); setZoomDrag({ a: startF, b: endF }); setHoverFrac(endF); };
    const up = () => {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
      setZoomDrag(null);
      const a = Math.min(startF, endF), b = Math.max(startF, endF);
      if (b - a > 0.01 && onZoom) {
        const za = t0 + a * (t1 - t0);
        const zb = t0 + b * (t1 - t0);
        onZoom([za, zb]);
      }
    };
    setZoomDrag({ a: startF, b: endF });
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  };
  const onDoubleClick = () => { if (onZoom) onZoom(null); };

  // Cursor position: use hover when present, else playhead t (if within window)
  const tCursor = hoverFrac !== null ? (t0 + hoverFrac * (t1 - t0)) : t;
  const cursorVisible = tCursor >= t0 && tCursor <= t1;
  const cursorFrac = (tCursor - t0) / (t1 - t0 || 1);
  const cursorX = xAtFrac(cursorFrac);

  // Values at cursor (interpolate) and current (end)
  const valueAt = (data, frac) => {
    const ix = frac * (N - 1);
    const i0 = Math.floor(ix), i1 = Math.min(N - 1, i0 + 1);
    const f = ix - i0;
    return data[i0] * (1 - f) + data[i1] * f;
  };

  // Legend data: name, current val, cursor val, color
  const legend = series.map((s) => ({
    sig: s.sig,
    current: s.data[N - 1],
    cursor: cursorVisible ? valueAt(s.data, cursorFrac) : null,
  }));

  const showHoverTooltip = hoverFrac !== null && series.length > 0;
  const zoomed = !!zoom;

  return (
    <div ref={wrap} style={{ width: '100%', height: height || '100%', position: 'relative', background: W_COLORS.bgInner }}>
      {/* Legend strip: name + current value for each signal */}
      <div style={{
        position: 'absolute', top: 4, left: padL, right: padR, zIndex: 2,
        display: 'flex', gap: 10, flexWrap: 'nowrap', overflow: 'hidden',
        fontFamily: '"JetBrains Mono", monospace', fontSize: compact ? 9 : 10,
        pointerEvents: 'none',
      }}>
        {legend.map((l) => (
          <div key={l.sig.id} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ width: 7, height: 2, background: l.sig.color, flexShrink: 0 }} />
            <span style={{ color: W_COLORS.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{l.sig.name}</span>
            <span style={{ color: W_COLORS.text, fontVariantNumeric: 'tabular-nums' }}>
              {fmtVal(l.current)}<span style={{ color: W_COLORS.textFaint, marginLeft: 2 }}>{l.sig.unit}</span>
            </span>
          </div>
        ))}
        <span style={{ flex: 1 }} />
        {zoomed && (
          <span onClick={onDoubleClick} style={{
            pointerEvents: 'auto', cursor: 'pointer',
            color: W_COLORS.accentBright, border: `1px solid ${W_COLORS.accentBright}55`,
            padding: '0 5px', fontSize: 9, letterSpacing: 0.5,
          }}>⤢ ZOOM · RESET</span>
        )}
      </div>

      <svg ref={svgRef} width={size.w} height={size.h}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        style={{ display: 'block', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, cursor: zoomDrag ? 'ew-resize' : 'crosshair', touchAction: 'none' }}>
        {/* Background */}
        <rect x={padL} y={padT} width={plotW} height={plotH} fill={W_COLORS.bgInner} />

        {/* Grid */}
        {yVals.map((v, i) => (
          <line key={'yg' + i} x1={padL} x2={padL + plotW} y1={y(v)} y2={y(v)}
            stroke={i === 0 || i === yTicks ? W_COLORS.gridMid : W_COLORS.grid} strokeWidth={1} />
        ))}
        {Array.from({ length: xTicks + 1 }).map((_, i) => (
          <line key={'xg' + i} x1={padL + (plotW * i) / xTicks} x2={padL + (plotW * i) / xTicks}
            y1={padT} y2={padT + plotH}
            stroke={i === 0 || i === xTicks ? W_COLORS.gridMid : W_COLORS.grid} strokeWidth={1} />
        ))}

        {/* Y labels */}
        {showAxes && yVals.map((v, i) => (
          <text key={'yl' + i} x={padL - 6} y={y(v) + 3} textAnchor="end" fill={W_COLORS.textMute} fontSize={compact ? 9 : 10}>
            {fmtVal(v)}
          </text>
        ))}

        {/* X labels */}
        {showAxes && Array.from({ length: xTicks + 1 }).map((_, i) => (
          <text key={'xl' + i} x={padL + (plotW * i) / xTicks} y={size.h - 4}
            textAnchor={i === 0 ? 'start' : i === xTicks ? 'end' : 'middle'}
            fill={W_COLORS.textMute} fontSize={compact ? 9 : 10}>
            {fmtTime(t0 + (t1 - t0) * (i / xTicks))}
          </text>
        ))}

        {/* Series */}
        {series.map((s, i) => {
          const color = s.sig.color || W_COLORS.accentBright;
          return (
            <g key={s.sig.id}>
              {style === 'area' && (
                <path d={areaPathFor(s.data)} fill={color} fillOpacity={0.12} stroke="none" />
              )}
              <path d={pathFor(s.data)} fill="none" stroke={color} strokeWidth={1.5}
                strokeLinejoin="round" strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 3px ${color}55)` }} />
              {/* End dot (current) */}
              <circle cx={x(N - 1)} cy={y(s.data[N - 1])} r={2.5} fill={color} />
              {/* Cursor dot */}
              {cursorVisible && hoverFrac !== null && (
                <circle cx={cursorX} cy={y(valueAt(s.data, cursorFrac))} r={3} fill={W_COLORS.bgInner} stroke={color} strokeWidth={1.5} />
              )}
            </g>
          );
        })}

        {/* Playhead cursor (from global t). Dashed if we're not hovering. */}
        {showCursor && cursorVisible && (
          <line
            x1={cursorX} x2={cursorX} y1={padT} y2={padT + plotH}
            stroke={hoverFrac !== null ? W_COLORS.accentBright : W_COLORS.accentBright}
            strokeWidth={1}
            strokeDasharray={hoverFrac !== null ? null : '2,3'}
            opacity={hoverFrac !== null ? 0.9 : 0.55}
          />
        )}

        {/* Zoom drag overlay */}
        {zoomDrag && (
          <rect
            x={xAtFrac(Math.min(zoomDrag.a, zoomDrag.b))}
            y={padT}
            width={Math.max(1, Math.abs(zoomDrag.b - zoomDrag.a) * plotW)}
            height={plotH}
            fill={W_COLORS.accentBright}
            fillOpacity={0.15}
            stroke={W_COLORS.accentBright}
            strokeOpacity={0.6}
            strokeDasharray="3,3"
          />
        )}
      </svg>

      {/* Hover tooltip: timestamp + per-signal values */}
      {showHoverTooltip && cursorVisible && (() => {
        const leftSide = cursorX > padL + plotW * 0.6;
        return (
          <div style={{
            position: 'absolute',
            top: padT + 4,
            left: leftSide ? undefined : cursorX + 8,
            right: leftSide ? Math.max(padR + 4, size.w - cursorX + 8) : undefined,
            background: 'rgba(10,11,13,0.95)',
            border: `1px solid ${W_COLORS.border}`,
            padding: '4px 6px',
            fontFamily: '"JetBrains Mono", monospace', fontSize: 9,
            pointerEvents: 'none', zIndex: 3,
            minWidth: 120,
          }}>
            <div style={{ color: W_COLORS.textFaint, letterSpacing: 0.5, marginBottom: 3 }}>{fmtTimeMs(tCursor)}</div>
            {legend.map((l) => (
              <div key={l.sig.id} style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: l.sig.color, flexShrink: 0 }} />
                  <span style={{ color: W_COLORS.textMute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>{l.sig.name}</span>
                </span>
                <span style={{ color: W_COLORS.text, fontVariantNumeric: 'tabular-nums' }}>
                  {l.cursor !== null ? fmtVal(l.cursor) : '—'}<span style={{ color: W_COLORS.textFaint, marginLeft: 2 }}>{l.sig.unit}</span>
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Bottom-right hint when zoomed or zooming */}
      {!zoomed && !zoomDrag && hoverFrac !== null && (
        <div style={{
          position: 'absolute', bottom: 2, right: padR,
          fontFamily: '"JetBrains Mono", monospace', fontSize: 8, color: W_COLORS.textFaint,
          letterSpacing: 0.5, pointerEvents: 'none',
        }}>DRAG TO ZOOM · DBL-CLICK RESET</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Numeric readout
// ────────────────────────────────────────────────────────────
function NumericWidget({ signal, t, compact = false }) {
  const sig = window.SIGNALS.byId(signal);
  if (!sig) return <EmptySlot label="No signal" />;
  const data = window.SIGNALS.sampleSignal(sig, Math.max(0, t - 0.02), t, 2);
  const v = data[data.length - 1];
  const pct = (v - sig.min) / (sig.max - sig.min);
  const warn = pct > 0.85 || pct < 0.05;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch', padding: compact ? '6px 12px' : '10px 18px', background: W_COLORS.bgInner }}>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: W_COLORS.textFaint, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {sig.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 500, fontSize: compact ? 28 : 42, color: warn ? W_COLORS.warn : W_COLORS.text, lineHeight: 1, letterSpacing: -1, fontVariantNumeric: 'tabular-nums' }}>
          {v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)}
        </div>
        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: W_COLORS.textMute }}>{sig.unit}</div>
      </div>
      {/* Spark range bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', marginTop: 8, position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(0, Math.min(100, pct * 100))}%`, background: warn ? W_COLORS.warn : sig.color }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontFamily: '"JetBrains Mono", monospace', fontSize: 9, color: W_COLORS.textFaint }}>
        <span>{sig.min}</span><span>{sig.max}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Gauge — circular arc
// ────────────────────────────────────────────────────────────
function GaugeWidget({ signal, t }) {
  const sig = window.SIGNALS.byId(signal);
  if (!sig) return <EmptySlot label="No signal" />;
  const data = window.SIGNALS.sampleSignal(sig, Math.max(0, t - 0.02), t, 2);
  const v = data[data.length - 1];
  const pct = Math.max(0, Math.min(1, (v - sig.min) / (sig.max - sig.min)));

  const wrap = React.useRef(null);
  const [sz, setSz] = React.useState(160);
  React.useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setSz(Math.min(e.contentRect.width, e.contentRect.height));
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const r = sz * 0.38;
  const cx = sz / 2, cy = sz / 2 + sz * 0.06;
  const startA = Math.PI * 0.8, endA = Math.PI * 2.2;
  const a = startA + (endA - startA) * pct;
  const arc = (from, to) => {
    const x1 = cx + Math.cos(from) * r, y1 = cy + Math.sin(from) * r;
    const x2 = cx + Math.cos(to) * r, y2 = cy + Math.sin(to) * r;
    const large = to - from > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const warn = pct > 0.85;
  const color = warn ? W_COLORS.warn : sig.color;

  return (
    <div ref={wrap} style={{ width: '100%', height: '100%', background: W_COLORS.bgInner, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, left: 12, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: W_COLORS.textFaint, letterSpacing: 0.5, textTransform: 'uppercase' }}>{sig.name}</div>
      <svg width={sz} height={sz} style={{ overflow: 'visible' }}>
        <path d={arc(startA, endA)} stroke="rgba(255,255,255,0.08)" strokeWidth={6} fill="none" strokeLinecap="round" />
        <path d={arc(startA, Math.max(startA + 0.001, a))} stroke={color} strokeWidth={6} fill="none" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
        {/* tick marks */}
        {Array.from({ length: 11 }).map((_, i) => {
          const ta = startA + (endA - startA) * (i / 10);
          const r1 = r + 8, r2 = r + 12;
          return <line key={i} x1={cx + Math.cos(ta) * r1} y1={cy + Math.sin(ta) * r1}
            x2={cx + Math.cos(ta) * r2} y2={cy + Math.sin(ta) * r2} stroke={W_COLORS.textFaint} strokeWidth={1} />;
        })}
        <text x={cx} y={cy + 4} textAnchor="middle" fill={W_COLORS.text} fontSize={sz * 0.18} fontWeight={500} fontFamily='"JetBrains Mono", monospace' style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: -1 }}>
          {v.toFixed(Math.abs(v) >= 100 ? 0 : 1)}
        </text>
        <text x={cx} y={cy + sz * 0.18} textAnchor="middle" fill={W_COLORS.textMute} fontSize={11} fontFamily='"JetBrains Mono", monospace'>
          {sig.unit}
        </text>
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Bar / level meter
// ────────────────────────────────────────────────────────────
function BarWidget({ signals = [], t, orientation = 'horizontal' }) {
  const sigs = signals.map((id) => window.SIGNALS.byId(id)).filter(Boolean);
  if (sigs.length === 0) return <EmptySlot label="No signal" />;
  const vals = sigs.map((s) => {
    const d = window.SIGNALS.sampleSignal(s, Math.max(0, t - 0.02), t, 2);
    return d[d.length - 1];
  });

  return (
    <div style={{ width: '100%', height: '100%', background: W_COLORS.bgInner, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
      {sigs.map((s, i) => {
        const v = vals[i];
        const pct = Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min)));
        const warn = pct > 0.85;
        return (
          <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: W_COLORS.textMute }}>
              <span style={{ color: W_COLORS.text }}>{s.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: warn ? W_COLORS.warn : W_COLORS.text }}>
                {v.toFixed(1)} <span style={{ color: W_COLORS.textFaint }}>{s.unit}</span>
              </span>
            </div>
            <div style={{ height: 10, background: 'rgba(255,255,255,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, background: warn ? W_COLORS.warn : s.color, transition: 'width 80ms linear' }} />
              {/* segment ticks */}
              {[0.25, 0.5, 0.75].map((f) => (
                <div key={f} style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: 'rgba(0,0,0,0.4)' }} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Heatmap — treats signals as a 2xN or 3xN grid (e.g. tire temps)
// ────────────────────────────────────────────────────────────
function HeatmapWidget({ signals = [], t, layout = 'tire4x3' }) {
  // Expect 12 signals for tire4x3 (FL/FR/RL/RR × Inner/Middle/Outer)
  const sigs = signals.map((id) => window.SIGNALS.byId(id)).filter(Boolean);
  const vals = sigs.map((s) => {
    const d = window.SIGNALS.sampleSignal(s, Math.max(0, t - 0.02), t, 2);
    return { s, v: d[d.length - 1] };
  });

  const heatColor = (pct) => {
    // cold → cyan, mid → green, hot → amber → red
    const stops = [
      [0, [80, 180, 220]],
      [0.4, [110, 231, 183]],
      [0.7, [232, 166, 72]],
      [1, [242, 87, 87]],
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const [p1, c1] = stops[i], [p2, c2] = stops[i + 1];
      if (pct <= p2) {
        const f = (pct - p1) / (p2 - p1);
        const c = c1.map((v, k) => Math.round(v + (c2[k] - v) * f));
        return `rgb(${c.join(',')})`;
      }
    }
    return 'rgb(242,87,87)';
  };

  // Assume FL(0,1,2) FR(3,4,5) RL(6,7,8) RR(9,10,11), columns = Inner/Middle/Outer
  const corners = [
    { name: 'FL', top: 0, left: 0 },
    { name: 'FR', top: 0, left: 1 },
    { name: 'RL', top: 1, left: 0 },
    { name: 'RR', top: 1, left: 1 },
  ];

  return (
    <div style={{ width: '100%', height: '100%', background: W_COLORS.bgInner, padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 16 }}>
      {corners.map((c, ci) => {
        const cells = vals.slice(ci * 3, ci * 3 + 3);
        if (cells.length === 0) return null;
        return (
          <div key={c.name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: W_COLORS.textMute, display: 'flex', justifyContent: 'space-between' }}>
              <span>{c.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(cells.reduce((a, x) => a + x.v, 0) / cells.length).toFixed(0)}°
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, flex: 1 }}>
              {cells.map((cell, i) => {
                const pct = (cell.v - cell.s.min) / (cell.s.max - cell.s.min);
                return (
                  <div key={i} style={{ background: heatColor(Math.max(0, Math.min(1, pct))), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: '#0a0b0d', fontWeight: 600 }}>
                    {cell.v.toFixed(0)}
                  </div>
                );
              })}
            </div>
            <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 8, color: W_COLORS.textFaint, display: 'flex', justifyContent: 'space-between' }}>
              <span>IN</span><span>MID</span><span>OUT</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptySlot({ label }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: W_COLORS.textFaint, background: W_COLORS.bgInner, border: `1px dashed ${W_COLORS.border}` }}>
      {label}
    </div>
  );
}

Object.assign(window, { GraphWidget, NumericWidget, GaugeWidget, BarWidget, HeatmapWidget, EmptySlot, W_COLORS });
