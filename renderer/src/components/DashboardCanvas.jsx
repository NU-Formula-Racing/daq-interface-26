import React from 'react';
import AngularGauge from './AngularGauge';

function ProgressBar({
  label = 'Metric',
  value = 50,
  min = 0,
  max = 100,
  color = '#22c55e',
  suffix = '%',
  orientation = 'horizontal',  
  thickness = 12,              

  showTicks = true,
  tickInterval = 10,           
  majorEvery = 10,             
  tickColor = 'rgba(255,255,255,.55)',
  labelColor = 'var(--muted,#9aa4b2)',
}) {
  const clamp = (x) => Math.max(min, Math.min(max, x));
  const pct = ((clamp(value) - min) / (max - min)) * 100;
  const range = max - min;

  const tickVals = showTicks
    ? Array.from({ length: Math.floor(range / tickInterval) + 1 }, (_, i) => min + i * tickInterval)
    : [];

  if (orientation === 'vertical') {
    const tickGutter = 32;  
    return (
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 6, height: '100%' }}>
        <div style={{ fontSize: 12, color: labelColor, textAlign: 'center' }}>{label}</div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${tickGutter}px ${thickness}px`,
            justifyContent: 'center',
            alignItems: 'stretch',
            height: '100%',
            columnGap: 8,
          }}
        >
          <div style={{ position: 'relative' }}>
            {tickVals.map((tv, i) => {
              const y = 100 - ((tv - min) / range) * 100; 
              const isMajor = majorEvery && ((tv - min) % majorEvery === 0);
              const len = isMajor ? 16 : 10;
              const weight = isMajor ? 2 : 1;
              return (
                <div key={i} style={{ position: 'absolute', right: 0, top: `${y}%`, transform: 'translateY(-0.5px)' }}>
                  <div
                    style={{
                      width: len,
                      height: weight,
                      background: tickColor,
                    }}
                  />
                  {isMajor && (
                    <div
                      style={{
                        position: 'absolute',
                        right: len + 6,
                        top: 0,
                        transform: 'translateY(-50%)',
                        fontSize: 10,
                        color: labelColor,
                      }}
                    >
                      {tv}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ position: 'relative', width: thickness, height: '100%' }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,.15)',
                borderRadius: 2,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                width: '100%',
                height: `${pct}%`,
                background: color,
                borderRadius: 2,
                transition: 'height .25s',
              }}
            />
          </div>
        </div>

        <div style={{ fontSize: 12, color: labelColor, textAlign: 'center' }}>
          {Math.round(value)}
          {suffix}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: labelColor }}>
        <span>{label}</span>
        <span>
          {Math.round(value)}
          {suffix}
        </span>
      </div>

      <div style={{ position: 'relative', height: thickness }}>
        {/* Track */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,.15)',
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 2,
            transition: 'width .25s',
          }}
        />
        {showTicks && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: -6, height: 6 }}>
            {tickVals.map((tv, i) => {
              const x = ((tv - min) / range) * 100;
              const isMajor = majorEvery && ((tv - min) % majorEvery === 0);
              const h = isMajor ? 6 : 4;
              const w = isMajor ? 2 : 1;
              return (
                <div key={i} style={{ position: 'absolute', left: `${x}%`, transform: 'translateX(-50%)' }}>
                  <div style={{ width: w, height: h, background: tickColor }} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardCanvas({
  layout,
  columns = 12,
  colWidth = 90,
  rowHeight = 80,    
  gap = 10,
  centered = true,
}) {
  const boardStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, ${colWidth}px)`,
    gridAutoRows: `${rowHeight ?? 84}px`,
    gap,
    width: 'max-content',
    ...(centered ? { margin: '0 auto' } : {}),
  };

  const Tile = ({
    col,            
    row,            
    span = 6,       
    rowSpan,        
    ratio,          
    height,         
    overlap = 0,    
    children
  }) => {
    
    const widthPx = span * colWidth;
    let hPx = height ?? (ratio ? widthPx / ratio : rowHeight);
    const mt = overlap ? -Math.round(hPx * overlap) : 0;

    
    const rows = Math.max(1, Math.ceil(hPx / rowHeight));
    const rSpan = rowSpan ?? rows;

  
    const gridColumn = col ? `${col} / span ${span}` : `span ${span}`;
    const gridRow    = row ? `${row} / span ${rSpan}` : `span ${rSpan}`;

    return (
      <div style={{ gridColumn, gridRow, marginTop: mt, width: widthPx, height: rSpan * rowHeight }}>
        <div style={{ width: '100%', height: '100%' }}>
          <div style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          { children}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={boardStyle}>
      {layout.map((t, i) => (
        <Tile
          key={t.id ?? i}
          col={t.col}
          row={t.row}
          span={t.span}
          rowSpan={t.rowSpan}
          ratio={t.ratio}
          height={t.height}
          overlap={t.overlap}
        >
          {t.type === 'gauge'
            ? <AngularGauge {...t.props} />
            : <div style={{ padding: 8, height: '100%', boxSizing: 'border-box' }}><ProgressBar {...t.props} /></div>}
        </Tile>
      ))}
    </div>
  );
}
