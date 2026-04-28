// FR Interface app demo - tiled grid of widgets that animate against fake signals.
// Ported from the Claude Design handoff bundle (demo-window.jsx).

import { useEffect, useRef, useState } from 'react';

const C = {
  bg: '#1a1a1a',
  panel: '#222222',
  panelAlt: '#1e1e1e',
  border: '#2e2e2e',
  borderSoft: '#383838',
  text: '#c8c8c8',
  textBright: '#e8e8e8',
  textDim: '#7a7a7a',
  textFaint: '#555555',
  amber: '#e89c3f',
  orange: '#e87f3f',
  coral: '#e85f4f',
  red: '#d23b3b',
  hot: '#e85a4a',
  yellow: '#e8c34a',
  pink: '#e85f7f',
  green: '#6aa84a',
  ok: '#6aa84a',
};
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const SANS = "'Inter Tight', Inter, -apple-system, sans-serif";

function sample(t) {
  const rpm = 4500 + Math.sin(t * 0.35) * 2200 + Math.sin(t * 0.95) * 600 + Math.sin(t * 2.1) * 180;
  const motorTemp = 71 + Math.sin(t * 0.18) * 6 + Math.sin(t * 0.55) * 1.2;
  const igbtTemp = 63 + Math.sin(t * 0.22 + 0.5) * 5 + Math.sin(t * 0.6) * 1;
  const coolant = 72 + Math.sin(t * 0.15) * 6;
  const speed = 95 + Math.sin(t * 0.4) * 35 + Math.sin(t * 0.9) * 5;
  const torque = 160 + Math.sin(t * 0.5) * 55 + Math.sin(t * 1.2) * 10;
  const hvSoc = Math.max(20, 88 - (t * 0.18) + Math.sin(t * 0.25) * 1.0);
  const brakeF = Math.max(0, 30 + Math.sin(t * 0.45 + 1) * 25 + Math.sin(t * 1.2) * 5);
  const brakeR = Math.max(0, 18 + Math.sin(t * 0.45 + 1.2) * 14 + Math.sin(t * 1.1) * 3);
  const tireRL = 114 + Math.sin(t * 0.28) * 2.5;
  const tireRR = 112 + Math.sin(t * 0.28 + 1) * 2.5;
  return { rpm, motorTemp, igbtTemp, coolant, speed, torque, hvSoc, brakeF, brakeR, tireRL, tireRR };
}

function KindIcon({ kind }) {
  const stroke = C.textDim;
  if (kind === 'GRAPH') return <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={stroke} strokeWidth="1"><path d="M1 9l3-4 2 2 4-6" /></svg>;
  if (kind === 'NUMERIC') return <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={stroke} strokeWidth="1"><text x="0" y="9" fontSize="9" fill={stroke} fontFamily={MONO}>123</text></svg>;
  if (kind === 'GAUGE') return <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={stroke} strokeWidth="1"><path d="M1.5 7.5a4 4 0 0 1 8 0" /><path d="M5.5 7.5l2-2" /></svg>;
  if (kind === 'BAR') return <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={stroke} strokeWidth="1"><rect x="1" y="6" width="2" height="4" /><rect x="4.5" y="3" width="2" height="7" /><rect x="8" y="5" width="2" height="5" /></svg>;
  if (kind === 'HEATMAP') return <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={stroke} strokeWidth="1"><rect x="1" y="1" width="3" height="3" /><rect x="4.5" y="1" width="3" height="3" /><rect x="1" y="4.5" width="3" height="3" /><rect x="4.5" y="4.5" width="3" height="3" /></svg>;
  return null;
}

function SignalPill({ name, color }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 4px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borderSoft}`, borderRadius: 2, fontFamily: MONO, fontSize: 10, color: C.textBright }}>
      <span style={{ width: 5, height: 5, borderRadius: 3, background: color }} />
      {name}
      <span style={{ color: C.textFaint, marginLeft: 1, fontSize: 9 }}>×</span>
    </span>
  );
}

function Widget({ kind, signals, children, extra }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: `1px solid ${C.border}`, background: C.panelAlt, fontFamily: MONO, fontSize: 10 }}>
        <span style={{ color: C.textDim, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <KindIcon kind={kind} />
          {kind}
          <span style={{ opacity: 0.5 }}>▾</span>
        </span>
        {signals.map((s, i) => (
          <SignalPill key={i} name={s.name} color={s.color} />
        ))}
        {extra && <span style={{ color: C.textFaint, fontSize: 10 }}>+{extra}</span>}
        <span style={{ color: C.textFaint, marginLeft: 2, cursor: 'pointer' }}>+</span>
        <span style={{ marginLeft: 'auto', color: C.textFaint, cursor: 'pointer' }}>×</span>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{children}</div>
    </div>
  );
}

function GraphBody({ series, history, gridY = 4 }) {
  const W = 1000, H = 300;
  const computeRange = (data) => {
    if (!data || data.length < 2) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(hi - lo, 0.001);
    const pad = span * 0.18;
    return [lo - pad, hi + pad];
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`gfill-${s.key}-${i}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {[...Array(gridY)].map((_, i) => {
        const y = (H * (i + 1)) / (gridY + 1);
        return <line key={i} x1="0" x2={W} y1={y} y2={y} stroke={C.border} strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}
      <line x1={W * 0.07} x2={W * 0.07} y1="0" y2={H} stroke={C.borderSoft} strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      {series.map((s, i) => {
        const data = history[s.key] || [];
        if (data.length < 2) return null;
        const [lo, hi] = computeRange(data);
        const range = hi - lo || 1;
        const pts = data.map((v, j) => {
          const x = (j / (data.length - 1)) * W;
          const y = H - ((v - lo) / range) * H * 0.85 - H * 0.075;
          return [x, y];
        });
        const lineD = 'M ' + pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ');
        const fillD = lineD + ` L ${W} ${H} L 0 ${H} Z`;
        return (
          <g key={i}>
            <path d={fillD} fill={`url(#gfill-${s.key}-${i})`} />
            <path d={lineD} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
}

function GraphWidget({ kind = 'GRAPH', signals, history, yLabels, xLabels, extra }) {
  return (
    <Widget kind={kind} signals={signals} extra={extra}>
      <div style={{ position: 'absolute', inset: 0, padding: '14px 10px 18px 44px' }}>
        <div style={{ position: 'absolute', left: 4, top: 6, bottom: 14, width: 38, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontFamily: MONO, fontSize: 8.5, color: C.textDim, textAlign: 'right' }}>
          {yLabels.map((l) => <span key={l}>{l}</span>)}
        </div>
        <div style={{ position: 'absolute', top: 4, left: 44, right: 10, fontFamily: MONO, fontSize: 9.5, color: C.textBright, display: 'flex', gap: 12 }}>
          {signals.slice(0, 3).map((s, i) => (
            <span key={i} style={{ color: s.color }}>{'\u2014'} {s.name} <span style={{ color: C.textBright, marginLeft: 2 }}>{s.cur}</span> <span style={{ color: C.textDim, marginLeft: 2 }}>{s.unit}</span></span>
          ))}
        </div>
        <div style={{ position: 'absolute', left: 44, right: 10, top: 18, bottom: 14, display: 'flex' }}>
          <GraphBody series={signals} history={history} />
        </div>
        <div style={{ position: 'absolute', left: 44, right: 10, bottom: 2, display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 8.5, color: C.textDim }}>
          {xLabels.map((l) => <span key={l}>{l}</span>)}
        </div>
      </div>
    </Widget>
  );
}

function NumericWidget({ signal, value, unit, min, max }) {
  const pct = Math.max(0, Math.min(1, (value - (min || 0)) / ((max || 100) - (min || 0))));
  return (
    <Widget kind="NUMERIC" signals={[signal]}>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: C.textDim }}>{signal.name.toUpperCase()}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: SANS, fontSize: 36, fontWeight: 500, color: C.textBright, lineHeight: 1, letterSpacing: -1 }}>{value}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.textDim }}>{unit}</span>
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ position: 'relative', height: 3, background: C.borderSoft, borderRadius: 1.5 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct * 100}%`, background: signal.color, borderRadius: 1.5 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 8.5, color: C.textFaint }}>
            <span>{min ?? 0}</span><span>{max ?? 100}</span>
          </div>
        </div>
      </div>
    </Widget>
  );
}

function BarWidget({ signals, values, max = 130, unit = 'kPa', extra }) {
  return (
    <Widget kind="BAR" signals={signals} extra={extra}>
      <div style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 14, height: '100%', justifyContent: 'center' }}>
        {values.map((v, i) => {
          const pct = Math.min(1, v / max);
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, color: C.text }}>
                <span style={{ color: signals[i].color }}>{signals[i].name}</span>
                <span style={{ color: C.textBright }}>{v.toFixed(1)} <span style={{ color: C.textDim }}>{unit}</span></span>
              </div>
              <div style={{ position: 'relative', height: 8, background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 1 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct * 100}%`, background: signals[i].color }} />
              </div>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}

function HeatmapWidget({ signals, t, extra }) {
  const cell = (base, t, jitter) => Math.round(base + Math.sin(t * 0.6 + jitter) * 6 + Math.cos(t * 1.1 + jitter * 2) * 2);
  const flCells = [cell(96, t, 0), cell(98, t, 0.4), cell(101, t, 0.8)];
  const frCells = [cell(91, t, 1.2), cell(93, t, 1.6), cell(89, t, 2.0)];
  const rlCells = [cell(87, t, 2.4), cell(88, t, 2.8), cell(89, t, 3.2)];
  const flAvg = Math.round((flCells[0] + flCells[1] + flCells[2]) / 3);
  const frAvg = Math.round((frCells[0] + frCells[1] + frCells[2]) / 3);
  const rlAvg = Math.round((rlCells[0] + rlCells[1] + rlCells[2]) / 3);

  const cellColor = (v) => {
    if (v >= 100) return { bg: C.coral, fg: '#1a1a1a' };
    if (v >= 95) return { bg: C.orange, fg: '#1a1a1a' };
    if (v >= 90) return { bg: C.amber, fg: '#1a1a1a' };
    return { bg: C.yellow, fg: '#1a1a1a' };
  };

  const Tire = ({ label, avg, cells }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, color: C.text }}>
        <span style={{ color: C.textDim }}>{label}</span>
        <span style={{ color: C.textBright }}>{avg}{'\u00B0'}</span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        {cells.map((v, i) => {
          const cc = cellColor(v);
          return (
            <div key={i} style={{ flex: 1, height: 38, background: cc.bg, color: cc.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{v}</div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 8.5, color: C.textFaint, paddingLeft: 2, paddingRight: 2 }}>
        <span>IN</span><span>MID</span><span>OUT</span>
      </div>
    </div>
  );

  return (
    <Widget kind="HEATMAP" signals={signals} extra={extra}>
      <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', height: '100%' }}>
        <Tire label="FL" avg={flAvg} cells={flCells} />
        <Tire label="FR" avg={frAvg} cells={frCells} />
        <Tire label="RL" avg={rlAvg} cells={rlCells} />
        <div />
      </div>
    </Widget>
  );
}

function AppHeader({ mode = 'LIVE' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: `1px solid ${C.border}`, background: C.panel, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
        <div style={{ width: 18, height: 18, borderRadius: 2, background: C.amber, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1a1a1a', fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>N</div>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.textBright, fontWeight: 600, letterSpacing: 0.5 }}>NFR</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.textDim }}>{'\u00B7'}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.text, letterSpacing: 0.5 }}>DAQ</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
        {['LIVE', 'REPLAY'].map((m) => {
          const active = m === mode;
          return (
            <span key={m} style={{
              padding: '3px 9px', borderRadius: 2,
              fontFamily: MONO, fontSize: 10, letterSpacing: 0.5,
              background: active ? (m === 'LIVE' ? 'rgba(106,168,74,0.18)' : 'rgba(232,156,63,0.18)') : 'transparent',
              color: active ? (m === 'LIVE' ? C.green : C.amber) : C.textDim,
              border: active ? `1px solid ${m === 'LIVE' ? 'rgba(106,168,74,0.4)' : 'rgba(232,156,63,0.35)'}` : `1px solid transparent`,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              {m === 'LIVE' && <span className="frwin-pulse" style={{ width: 5, height: 5, borderRadius: 3, background: C.green }} />}
              {m}
            </span>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.textDim }}>2026-04-21</span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.text, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Session #17 <span style={{ opacity: 0.5 }}>{'\u25BE'}</span></span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.textDim, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: 2 }}>{'\u21BA'} RESET</span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.textDim, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', border: `1px solid ${C.border}`, borderRadius: 2 }}>{'\u2193'} EXPORT</span>
    </div>
  );
}

function ToolbarRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', borderBottom: `1px solid ${C.border}`, background: C.panelAlt, gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.textDim, letterSpacing: 1 }}>LAYOUT {'\u00B7'} 9</span>
      <div style={{ flex: 1 }} />
      {[
        { k: '+ GRAPH', i: 'GRAPH' },
        { k: '+ NUMERIC', i: 'NUMERIC' },
        { k: '+ GAUGE', i: 'GAUGE' },
        { k: '+ BAR', i: 'BAR' },
        { k: '+ HEATMAP', i: 'HEATMAP' },
      ].map((b) => (
        <span key={b.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', border: `1px solid ${C.border}`, borderRadius: 2, fontFamily: MONO, fontSize: 10, color: C.text }}>
          <KindIcon kind={b.i} />
          {b.k}
        </span>
      ))}
    </div>
  );
}

function LeftRail() {
  return (
    <div style={{ width: 24, borderRight: `1px solid ${C.border}`, background: C.panelAlt, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0', gap: 14 }}>
      <span style={{ fontFamily: MONO, fontSize: 9, color: C.textDim, letterSpacing: 1, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>SIGNALS</span>
    </div>
  );
}

export default function FRWindow({ width = '100%', height = 580 }) {
  const [t, setT] = useState(2.4);
  useEffect(() => {
    let raf, start = performance.now();
    const tick = (now) => { setT(2.4 + (now - start) / 1000); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const sig = sample(t);

  const hist = useRef(null);
  if (!hist.current) {
    hist.current = { rpm: [], motorTemp: [], igbtTemp: [], coolant: [], hvSoc: [], brakeF: [], brakeR: [] };
    const N = 200;
    const span = 4.0;
    for (let i = 0; i < N; i++) {
      const tt = (i / (N - 1)) * span;
      const s = sample(tt);
      for (const k of Object.keys(hist.current)) hist.current[k].push(s[k]);
    }
  }
  for (const k of Object.keys(hist.current)) {
    const arr = hist.current[k];
    arr.push(sig[k]);
    if (arr.length > 220) arr.shift();
  }

  return (
    <div style={{
      width, height, borderRadius: 6, overflow: 'hidden',
      background: C.bg,
      boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 28px 80px -20px rgba(0,0,0,0.6), 0 12px 32px -8px rgba(0,0,0,0.4)',
      display: 'flex', flexDirection: 'column', fontFamily: SANS, color: C.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '7px 12px', background: '#0f0f0f', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', gap: 7 }}>
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#ff5f57' }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#febc2e' }} />
          <div style={{ width: 11, height: 11, borderRadius: 6, background: '#28c840' }} />
        </div>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: C.textDim, fontFamily: MONO }}>nfrInterface {'\u2014'} NFR 26 {'\u2014'} Session #17</div>
      </div>

      <AppHeader mode="LIVE" />
      <ToolbarRow />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftRail />
        <div style={{
          flex: 1, padding: 6, display: 'grid', gap: 6, minHeight: 0,
          gridTemplateColumns: '2fr 1.6fr 0.9fr 0.9fr 1.2fr',
          gridTemplateRows: '1fr 1fr 1fr',
          gridTemplateAreas: `
            "rpm rpm rpm soc soc"
            "temps temps speed torque tires"
            "heat heat heat brake brake"
          `,
        }}>
          <div style={{ gridArea: 'rpm', minHeight: 0, position: 'relative' }}>
            <GraphWidget
              signals={[{ name: 'Inverter_RPM', color: C.amber, key: 'rpm', cur: Math.round(sig.rpm) + ' rpm', unit: '', min: 0, max: 9000 }]}
              history={hist.current}
              yLabels={['8000', '6000', '4000', '2000', '0']}
              xLabels={['00:00', '15:00', '30:00', '45:00', '60:00']}
            />
          </div>

          <div style={{ gridArea: 'soc', minHeight: 0, position: 'relative' }}>
            <GraphWidget
              signals={[{ name: 'HV_Battery_SOC', color: C.coral, key: 'hvSoc', cur: sig.hvSoc.toFixed(1) + ' %', unit: '', min: 0, max: 100 }]}
              history={hist.current}
              yLabels={['100', '75', '50', '25', '0']}
              xLabels={['48:00', '49:30', '50:15', '51:00']}
            />
          </div>

          <div style={{ gridArea: 'temps', minHeight: 0, position: 'relative' }}>
            <GraphWidget
              signals={[
                { name: 'Motor_Temperature', color: C.amber, key: 'motorTemp', cur: sig.motorTemp.toFixed(1), unit: `${'\u00B0'}C`, min: 20, max: 100 },
                { name: 'IGBT_Temperature', color: C.coral, key: 'igbtTemp', cur: sig.igbtTemp.toFixed(1), unit: `${'\u00B0'}C`, min: 20, max: 100 },
                { name: 'Coolant_Temp_Out', color: C.pink, key: 'coolant', cur: sig.coolant.toFixed(1), unit: `${'\u00B0'}C`, min: 20, max: 100 },
              ]}
              extra={1}
              history={hist.current}
              yLabels={['95.0', '76.3', '57.5', '38.8', '20.0']}
              xLabels={['48:00', '49:12', '50:24', '51:36', '52:48']}
            />
          </div>

          <div style={{ gridArea: 'speed', minHeight: 0, position: 'relative' }}>
            <NumericWidget
              signal={{ name: 'Vehicle_Speed', color: C.amber }}
              value={Math.round(sig.speed)} unit="km/h" min={0} max={130}
            />
          </div>

          <div style={{ gridArea: 'torque', minHeight: 0, position: 'relative' }}>
            <NumericWidget
              signal={{ name: 'Inverter_Torque', color: C.amber }}
              value={Math.round(sig.torque)} unit="Nm" min={-50} max={220}
            />
          </div>

          <div style={{ gridArea: 'tires', minHeight: 0, position: 'relative' }}>
            <BarWidget
              signals={[
                { name: 'Tire_Pressure_RL', color: C.amber },
                { name: 'Tire_Pressure_RR', color: C.amber },
              ]}
              values={[sig.tireRL, sig.tireRR]}
              max={130}
            />
          </div>

          <div style={{ gridArea: 'heat', minHeight: 0, position: 'relative' }}>
            <HeatmapWidget
              signals={[
                { name: 'Tire_Temp_FL_Inner', color: C.green },
                { name: 'Tire_Temp_FR_Middle', color: C.green },
              ]}
              extra={7}
              t={t}
            />
          </div>

          <div style={{ gridArea: 'brake', minHeight: 0, position: 'relative' }}>
            <GraphWidget
              signals={[
                { name: 'Brake_Pressure_Front', color: C.pink, key: 'brakeF', cur: sig.brakeF.toFixed(1), unit: 'bar', min: 0, max: 90 },
                { name: 'Brake_Pressure_Rear', color: C.pink, key: 'brakeR', cur: sig.brakeR.toFixed(1), unit: 'bar', min: 0, max: 90 },
              ]}
              history={hist.current}
              yLabels={['90.0', '67.5', '45.0', '22.5', '0.0']}
              xLabels={['46:48', '48:45', '50:42', '52:39', '54:36']}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
