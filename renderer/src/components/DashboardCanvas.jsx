import React from 'react';
import AngularGauge from './AngularGauge';

function ProgressBar({ label='Metric', value=50, min=0, max=100, color='#7c3aed', suffix='%' }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div style={{display:'grid', gap:6}}>
      <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--muted,#9aa4b2)'}}>
        <span>{label}</span><span>{Math.round(value)}{suffix}</span>
      </div>
      <div style={{height:10, borderRadius:999, background:'rgba(255,255,255,.08)', overflow:'hidden'}}>
        <div style={{width:`${pct}%`, height:'100%', background:color, borderRadius:999, transition:'width .25s'}}/>
      </div>
    </div>
  );
}

export default function DashboardCanvas({
  layout, 
  columns = 12,
  colWidth = 90,
  gap = 10,
  centered = true,
}) {
  const boardStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, ${colWidth}px)`,
    gap,
    width: 'max-content',
    ...(centered ? { margin: '0 auto' } : {}),
    gridAutoFlow: 'row dense',
  };

  const Tile = ({ span = 6, ratio = 2, height, overlap = 0, children }) => {
    const widthPx = span * colWidth;
    const h = ratio ? widthPx / ratio : (height ?? 90);
    const mt = overlap ? -Math.round(h * overlap) : 0;
    return (
      <div style={{ gridColumn: `span ${span}`, marginTop: mt, width: widthPx }}>
        <div style={{ width: '100%', height: ratio ? undefined : h, aspectRatio: ratio ? `${ratio}/1` : undefined }}>
          <div style={{ width:'100%', height:'100%' }}>{children}</div>
        </div>
      </div>
    );
  };

  return (
    <div style={boardStyle}>
      {layout.map((t, i) => (
        <Tile key={t.id ?? i} span={t.span} ratio={t.ratio} height={t.height} overlap={t.overlap}>
          {t.type === 'gauge'
            ? <AngularGauge {...t.props} />
            : <div style={{ padding: 8 }}><ProgressBar {...t.props} /></div>}
        </Tile>
      ))}
    </div>
  );
}