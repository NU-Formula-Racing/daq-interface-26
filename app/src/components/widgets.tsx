// Shared widget renderers. Pure presentational — read from current time/data.
// Each widget: <GraphWidget/>, <NumericWidget/>, <GaugeWidget/>, <BarWidget/>, <HeatmapWidget/>
import React, { useRef, useState, useLayoutEffect } from 'react';
import type { Signal } from '../signals/catalog.ts';
import { useCatalog } from './SignalsProvider.tsx';
import { useFrames } from './FramesContext.tsx';
import { COLORS as W_COLORS } from './colors.ts';

// ────────────────────────────────────────────────────────────
// Graph — oscilloscope-style line/area/step
// ────────────────────────────────────────────────────────────
interface GraphWidgetProps {
  signals?: any[];
  t: number;
  window?: number;
  style?: 'line' | 'area' | 'step';
  density?: string;
  compact?: boolean;
  showAxes?: boolean;
  showCursor?: boolean;
  height?: number | string;
  zoom?: [number, number] | null;
  onZoom?: (z: [number, number] | null) => void;
  mode?: 'live' | 'replay';
}

export function GraphWidget({
  signals = [], t, window: win = 0.05, style = 'line',
  density = 'normal', compact = false, showAxes = true, showCursor = true, height,
  zoom = null, onZoom, mode = 'replay',
}: GraphWidgetProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 320, h: 160 });
  const [hoverFrac, setHoverFrac] = useState<number | null>(null); // 0..1 within plot
  const [zoomDrag, setZoomDrag] = useState<{ a: number; b: number } | null>(null);

  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // Determine window [t0, t1]
  let t0: number, t1: number;
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

  const padL = compact ? 32 : 40, padR = 8, padT = compact ? 18 : 22, padB = compact ? 16 : 20;
  const plotW = Math.max(10, size.w - padL - padR);
  const plotH = Math.max(10, size.h - padT - padB);
  const N = Math.max(40, Math.min(800, Math.round(plotW * 1.2)));

  // Sample signals — read real data from frames store. Normalize to length N
  // by resampling/padding so the rest of the plotting math is unchanged.
  const resampleToN = (values: number[], n: number): number[] => {
    if (values.length === 0) return new Array(n).fill(0);
    if (values.length === 1) return new Array(n).fill(values[0]);
    const out = new Array(n);
    const last = values.length - 1;
    for (let i = 0; i < n; i++) {
      const fx = (i / (n - 1)) * last;
      const i0 = Math.floor(fx);
      const i1 = Math.min(last, i0 + 1);
      const f = fx - i0;
      out[i] = values[i0] * (1 - f) + values[i1] * f;
    }
    return out;
  };
  const series = signals.map((sid: any) => {
    const sig = catalog.resolve(sid);
    if (!sig) return null;
    const allRaw = (frames?.series(sig.id) ?? []).map((r) => r.value);
    if (allRaw.length === 0) return { sig, data: new Array(N).fill(0), empty: true };

    // Decide which slice of the buffer to render.
    // - Live: rolling window — last `win` fraction of the buffer ending at "now".
    //   We treat `t === 1` as latest. Show last `win * bufferLen` points (clamped).
    // - Replay/paused: window ends at `t * bufferLen`, length `win * bufferLen`.
    const len = allRaw.length;
    const winLen = Math.max(8, Math.floor(len * win));
    let start: number, end: number;
    if (mode === 'live') {
      end = len;
      start = Math.max(0, len - winLen);
    } else {
      end = Math.max(1, Math.min(len, Math.floor(t * len)));
      start = Math.max(0, end - winLen);
    }
    const sliced = allRaw.slice(start, end);
    if (sliced.length === 0) return { sig, data: new Array(N).fill(0), empty: true };
    const data = resampleToN(sliced, N);
    return { sig, data };
  }).filter(Boolean) as { sig: Signal; data: number[]; empty?: boolean }[];

  // Domain: prefer customized catalog ranges; fall back to data range with 5% pad
  let dMin = Infinity, dMax = -Infinity;
  if (series.length === 0) {
    dMin = 0; dMax = 1;
  } else {
    const isDefaultRange = (sig: { min: number; max: number }) =>
      sig.min === 0 && sig.max === 1;

    for (const s of series) {
      if (s.empty) continue;
      if (isDefaultRange(s.sig)) {
        let lo = Infinity, hi = -Infinity;
        for (const v of s.data) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (lo === Infinity) { lo = 0; hi = 1; }
        if (hi === lo) {
          lo -= 0.5;
          hi += 0.5;
        } else {
          const pad = (hi - lo) * 0.05;
          lo -= pad;
          hi += pad;
        }
        dMin = Math.min(dMin, lo);
        dMax = Math.max(dMax, hi);
      } else {
        dMin = Math.min(dMin, s.sig.min);
        dMax = Math.max(dMax, s.sig.max);
      }
    }
    if (dMin === Infinity) { dMin = 0; dMax = 1; }
  }
  const dSpan = dMax - dMin || 1;

  const y = (v: number) => padT + plotH - ((v - dMin) / dSpan) * plotH;
  const x = (i: number) => padL + (i / (N - 1)) * plotW;
  const xAtFrac = (f: number) => padL + f * plotW;

  const yTicks = 4;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => dMin + (dSpan * i) / yTicks);
  const xTicks = compact ? 4 : 6;

  const fmtTime = (tt: number) => {
    const m = Math.floor(tt * 60) % 60;
    const s = Math.floor(tt * 3600) % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const fmtTimeMs = (tt: number) => {
    const m = Math.floor(tt * 60) % 60;
    const s = Math.floor(tt * 3600) % 60;
    const ms = Math.floor((tt * 3600 * 1000) % 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  const fmtVal = (v: number) => {
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
  };

  const pathFor = (data: number[]) => {
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
  const areaPathFor = (data: number[]) => {
    let d = `M ${x(0)} ${padT + plotH}`;
    d += ` L ${x(0)} ${y(data[0])}`;
    for (let i = 1; i < data.length; i++) d += ` L ${x(i)} ${y(data[i])}`;
    d += ` L ${x(N - 1)} ${padT + plotH} Z`;
    return d;
  };

  // ── Pointer handlers for hover + zoom-to-region ──
  const fracFromEvent = (e: any) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left - padL;
    return Math.max(0, Math.min(1, px / plotW));
  };
  const onPointerMove = (e: any) => {
    if (!svgRef.current) return;
    const f = fracFromEvent(e);
    setHoverFrac(f);
    if (zoomDrag) setZoomDrag({ a: zoomDrag.a, b: f });
  };
  const onPointerLeave = () => { if (!zoomDrag) setHoverFrac(null); };
  const onPointerDown = (e: any) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const f = fracFromEvent(e);
    const startF = f;
    let endF = f;
    const mv = (ev: any) => { endF = fracFromEvent(ev); setZoomDrag({ a: startF, b: endF }); setHoverFrac(endF); };
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
  const valueAt = (data: number[], frac: number) => {
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
        {/* padB reference for TS: (no-op; padB used implicitly via plotH) */}
        {padB < 0 && <text>{padB}</text>}

        {/* Series */}
        {series.map((s) => {
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
            strokeDasharray={hoverFrac !== null ? undefined : '2,3'}
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
interface NumericWidgetProps { signal: any; t: number; compact?: boolean; }
export function NumericWidget({ signal, compact = false }: NumericWidgetProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const sig = catalog.resolve(signal);
  if (!sig) return <EmptySlot label="No signal" />;
  const latest = frames?.latest(sig.id) ?? null;
  const v = latest ? latest.value : null;

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: compact ? '12px 16px' : '18px 22px',
      background: W_COLORS.bgInner,
    }}>
      <div style={{
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 11, color: W_COLORS.textMute, letterSpacing: 1.5,
        textTransform: 'uppercase', fontWeight: 400,
      }}>
        {sig.name}
      </div>
      <div style={{
        fontFamily: '"Inter", system-ui, sans-serif',
        fontWeight: 300, fontSize: compact ? 44 : 64,
        color: W_COLORS.text, lineHeight: 1.05, letterSpacing: -2,
        fontVariantNumeric: 'tabular-nums', marginTop: 4,
      }}>
        {v != null ? v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) : '—'}
      </div>
      {sig.unit && (
        <div style={{
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSize: 11, color: W_COLORS.textMute, letterSpacing: 1.5,
          textTransform: 'uppercase', marginTop: 4, fontWeight: 400,
        }}>
          {sig.unit}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Gauge — circular arc
// ────────────────────────────────────────────────────────────
interface GaugeWidgetProps { signal: any; t: number; }
export function GaugeWidget({ signal }: GaugeWidgetProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const sig = catalog.resolve(signal);

  const wrap = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState(160);
  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setSz(Math.min(e.contentRect.width, e.contentRect.height));
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  if (!sig) return <EmptySlot label="No signal" />;
  const latest = frames?.latest(sig.id) ?? null;
  const v = latest ? latest.value : null;
  const pct = v != null ? Math.max(0, Math.min(1, (v - sig.min) / (sig.max - sig.min))) : 0;

  const r = sz * 0.38;
  const cx = sz / 2, cy = sz / 2 + sz * 0.06;
  const startA = Math.PI * 0.8, endA = Math.PI * 2.2;
  const a = startA + (endA - startA) * pct;
  const arc = (from: number, to: number) => {
    const x1 = cx + Math.cos(from) * r, y1 = cy + Math.sin(from) * r;
    const x2 = cx + Math.cos(to) * r, y2 = cy + Math.sin(to) * r;
    const large = to - from > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const color = sig.color;

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
          {v != null ? v.toFixed(Math.abs(v) >= 100 ? 0 : 1) : '—'}
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
interface BarWidgetProps { signals?: any[]; t: number; orientation?: 'horizontal' | 'vertical'; }
export function BarWidget({ signals = [] }: BarWidgetProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const sigs = signals.map((id: any) => catalog.resolve(id)).filter(Boolean) as Signal[];
  if (sigs.length === 0) return <EmptySlot label="No signal" />;
  const vals = sigs.map((s) => frames?.latest(s.id)?.value ?? null);

  return (
    <div style={{ width: '100%', height: '100%', background: W_COLORS.bgInner, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
      {sigs.map((s, i) => {
        const v = vals[i];
        const pct = v != null ? Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))) : 0;
        return (
          <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: W_COLORS.textMute }}>
              <span style={{ color: W_COLORS.text }}>{s.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: W_COLORS.text }}>
                {v != null ? v.toFixed(1) : '—'} <span style={{ color: W_COLORS.textFaint }}>{s.unit}</span>
              </span>
            </div>
            <div style={{ height: 10, background: 'rgba(255,255,255,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, background: s.color, transition: 'width 80ms linear' }} />
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
interface HeatmapWidgetProps { signals?: any[]; t: number; layout?: string; }
export function HeatmapWidget({ signals = [] }: HeatmapWidgetProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  // Expect 12 signals for tire4x3 (FL/FR/RL/RR × Inner/Middle/Outer)
  const sigs = signals.map((id: any) => catalog.resolve(id)).filter(Boolean) as Signal[];
  const vals = sigs.map((s) => ({ s, v: frames?.latest(s.id)?.value ?? null }));

  const heatColor = (pct: number) => {
    // cold → cyan, mid → green, hot → amber → red
    const stops: [number, number[]][] = [
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
                {(() => {
                  const nums = cells.map((x) => x.v).filter((v): v is number => v != null);
                  return nums.length ? `${(nums.reduce((a, x) => a + x, 0) / nums.length).toFixed(0)}°` : '—';
                })()}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, flex: 1 }}>
              {cells.map((cell, i) => {
                if (cell.v == null) {
                  return (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: W_COLORS.textFaint }}>—</div>
                  );
                }
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

export function EmptySlot({ label }: { label: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"JetBrains Mono", monospace', fontSize: 11, color: W_COLORS.textFaint, background: W_COLORS.bgInner, border: `1px dashed ${W_COLORS.border}` }}>
      {label}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Shell UI bits ported from shell.jsx — SignalChip, SignalPicker,
// GroupPill, Timeline, WidgetShell, TopBar. (shell.jsx had
// `const SH_COLORS = W_COLORS;` so they share this module's palette.)
// ════════════════════════════════════════════════════════════
const SH_COLORS = W_COLORS;

// ────────────────────────────────────────────────────────────
// SignalChip — group color dot + name
// ────────────────────────────────────────────────────────────
interface SignalChipProps {
  sigId: any;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  size?: 'xs' | 'sm';
}
export function SignalChip({ sigId, onRemove, onClick, active, size = 'sm' }: SignalChipProps) {
  const catalog = useCatalog();
  const sig = catalog.resolve(sigId);
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
// GroupPill
// ────────────────────────────────────────────────────────────
interface GroupPillProps { label: string; color?: string; active?: boolean; onClick?: () => void; }
export function GroupPill({ label, color, active, onClick }: GroupPillProps) {
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
// SignalPicker — searchable list with group filter
// ────────────────────────────────────────────────────────────
interface SignalPickerProps {
  onPick?: (id: any) => void;
  selected?: any[];
  multi?: boolean;
  compact?: boolean;
  filter?: string;
  height?: number | string;
  onFilterChange?: (s: string) => void;
}
export function SignalPicker({ onPick, selected = [], compact = false, filter = '', height = '100%', onFilterChange }: SignalPickerProps) {
  const catalog = useCatalog();
  const [localFilter, setLocalFilter] = useState(filter);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const q = (onFilterChange ? filter : localFilter).toLowerCase();

  const matches = catalog.ALL.filter((s) => {
    if (groupFilter !== 'all' && s.group !== groupFilter) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.groupName.toLowerCase().includes(q);
  });

  // Group matches for rendering
  const byGroup: Record<string, { name: string; signals: Signal[] }> = {};
  for (const s of matches) {
    if (!byGroup[s.group]) byGroup[s.group] = { name: s.groupName, signals: [] };
    byGroup[s.group].signals.push(s);
  }
  const groupOrder = catalog.GROUPS.map((g) => g.id).filter((g) => byGroup[g]);

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
          {catalog.GROUPS.map((g) => (
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
                    onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
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
        {matches.length} / {catalog.ALL.length} SIGNALS
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Timeline — used by all three for Replay scrubbing, Live for pause/scrub-back
// ────────────────────────────────────────────────────────────
interface TimelineProps {
  t: number;
  onChange: (t: number) => void;
  duration?: number;
  mode?: 'live' | 'replay';
  compact?: boolean;
}
export function Timeline({ t, onChange, duration = 1, mode, compact }: TimelineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverT, setHoverT] = useState(0);

  const onDown = (e: any) => {
    const rect = ref.current!.getBoundingClientRect();
    const move = (ev: any) => {
      const x = ((ev.clientX || ev.touches?.[0]?.clientX) - rect.left) / rect.width;
      onChange(Math.max(0, Math.min(1, x)) * duration);
    };
    move(e);
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };
  const onMove = (e: any) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    setHoverX(x);
    setHoverT((x / rect.width) * duration);
  };

  const pct = (t / duration) * 100;

  // Event markers (pseudo laps / flags) — deterministic
  const markers = React.useMemo(() => {
    const out: { pos: number; label: string; kind: 'lap' | 'warn' | 'info' }[] = [];
    for (let i = 1; i <= 6; i++) out.push({ pos: i / 7, label: `L${i}`, kind: 'lap' });
    out.push({ pos: 0.28, label: 'FAULT', kind: 'warn' });
    out.push({ pos: 0.62, label: 'PIT', kind: 'info' });
    return out;
  }, []);

  const fmt = (tt: number) => {
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
export const WIDGET_TYPES = [
  { id: 'graph', label: 'GRAPH', icon: 'graph' },
  { id: 'numeric', label: 'NUMERIC', icon: 'num' },
  { id: 'gauge', label: 'GAUGE', icon: 'gauge' },
  { id: 'bar', label: 'BAR', icon: 'bar' },
  { id: 'heatmap', label: 'HEATMAP', icon: 'heat' },
];

export function WidgetIcon({ kind, size = 10 }: { kind?: string; size?: number }) {
  const s = size;
  const common: any = { width: s, height: s, stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' };
  switch (kind) {
    case 'graph': return <svg {...common} viewBox="0 0 10 10"><polyline points="0,8 2,4 4,6 6,2 8,5 10,3"/></svg>;
    case 'num': return <svg {...common} viewBox="0 0 10 10" fill="currentColor" stroke="none"><rect x="1" y="3" width="8" height="4" rx="0.5"/></svg>;
    case 'gauge': return <svg {...common} viewBox="0 0 10 10"><path d="M2 8 A3 3 0 0 1 8 8"/><line x1="5" y1="8" x2="7" y2="4"/></svg>;
    case 'bar': return <svg {...common} viewBox="0 0 10 10"><rect x="1" y="4" width="8" height="1.5"/><rect x="1" y="7" width="5" height="1.5"/></svg>;
    case 'heat': return <svg {...common} viewBox="0 0 10 10" fill="currentColor" stroke="none"><rect x="1" y="1" width="3" height="3"/><rect x="5" y="1" width="3" height="3" opacity="0.6"/><rect x="1" y="5" width="3" height="3" opacity="0.4"/><rect x="5" y="5" width="3" height="3" opacity="0.8"/></svg>;
    default: return null;
  }
}

interface WidgetShellProps {
  widget: any;
  t: number;
  mode?: 'live' | 'replay';
  onChange: (next: any) => void;
  onRemove?: () => void;
  onAssignSignal?: (sid: any) => void;
  density?: string;
  graphStyle?: 'line' | 'area' | 'step';
  children?: React.ReactNode;
  draggable?: boolean;
  onDragStart?: (e: any) => void;
  onHeaderClick?: () => void;
}
export function WidgetShell({ widget, t, mode = 'replay', onChange, onRemove, density = 'comfortable', graphStyle = 'line', children, draggable, onDragStart, onHeaderClick }: WidgetShellProps) {
  const [typeOpen, setTypeOpen] = useState(false);
  const compact = density === 'compact';

  const renderBody = () => {
    switch (widget.type) {
      case 'graph': return <GraphWidget signals={widget.signals} t={t} mode={mode} window={widget.window || 0.05} style={graphStyle} compact={compact} zoom={widget.zoom || null} onZoom={(z) => onChange({ ...widget, zoom: z })} />;
      case 'numeric': return <NumericWidget signal={widget.signals[0]} t={t} compact={compact} />;
      case 'gauge': return <GaugeWidget signal={widget.signals[0]} t={t} />;
      case 'bar': return <BarWidget signals={widget.signals} t={t} />;
      case 'heatmap': return <HeatmapWidget signals={widget.signals} t={t} />;
      default: return <EmptySlot label="Pick a type" />;
    }
  };

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
          <button onClick={(e) => { e.stopPropagation(); setTypeOpen((o) => !o); }} style={headerBtn()}>
            <WidgetIcon kind={WIDGET_TYPES.find((x) => x.id === widget.type)?.icon} />
            <span>{(widget.type as string).toUpperCase()}</span>
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
            <span style={{ color: SH_COLORS.textFaint, fontSize: 10, fontStyle: 'italic', padding: '2px 5px' }}>
              (focus to add signal)
            </span>
          )}
          {widget.signals.slice(0, compact ? 2 : 4).map((sid: any) => (
            <SignalChip key={sid} sigId={sid} size="xs"
              onRemove={() => onChange({ ...widget, signals: widget.signals.filter((x: any) => x !== sid) })} />
          ))}
          {widget.signals.length > (compact ? 2 : 4) && (
            <span style={{ color: SH_COLORS.textMute, fontSize: 10 }}>+{widget.signals.length - (compact ? 2 : 4)}</span>
          )}
        </div>

        {onRemove && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ ...headerBtn(), color: SH_COLORS.textFaint, padding: '2px 5px' }} title="Remove">×</button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {children || renderBody()}
      </div>
    </div>
  );
}

function headerBtn(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px',
    background: 'transparent', border: `1px solid transparent`, color: SH_COLORS.text,
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, cursor: 'pointer', letterSpacing: 0.5,
  };
}
function dropdown(): React.CSSProperties {
  return {
    position: 'absolute', top: '100%', left: 0, marginTop: 2, background: SH_COLORS.bgInner,
    border: `1px solid ${SH_COLORS.border}`, minWidth: 120, zIndex: 52,
    boxShadow: '0 6px 20px rgba(0,0,0,0.5)', padding: 2,
  };
}
function dropItem(active: boolean): React.CSSProperties {
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
interface TopBarProps {
  mode: 'live' | 'replay';
  onMode: (m: 'live' | 'replay') => void;
  title?: string;
  session?: string;
  date?: string;
  right?: React.ReactNode;
  /** Slot for extra navigation, rendered immediately after the LIVE/REPLAY toggle. */
  nav?: React.ReactNode;
  /** Replaces the hardcoded date + session label with a custom node when set. */
  sessionSlot?: React.ReactNode;
  compact?: boolean;
}
export function TopBar({ mode, onMode, title = 'NFR · DAQ', session = 'Session #17', date = '2026-04-21', right, nav, sessionSlot, compact }: TopBarProps) {
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
        {(['live', 'replay'] as const).map((m) => (
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

      {nav}

      <div style={{ flex: 1 }} />

      {sessionSlot ?? (
        <>
          <span style={{ color: SH_COLORS.textMute, fontSize: 10 }}>{date}</span>
          <span style={{ color: SH_COLORS.text, fontSize: 10, padding: '3px 8px', border: `1px solid ${SH_COLORS.border}`, borderRadius: 2 }}>{session} ▾</span>
        </>
      )}
      {right}
    </div>
  );
}

export function NFRMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20">
      <rect width="20" height="20" fill="#4E2A84"/>
      <path d="M5 14 L5 6 L7 6 L12 11 L12 6 L14 6 L14 14 L12 14 L7 9 L7 14 Z" fill="#fff"/>
    </svg>
  );
}
