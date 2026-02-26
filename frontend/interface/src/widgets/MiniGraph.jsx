import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ReferenceArea, ReferenceDot,
} from 'recharts';
import useChartZoom from '@/hooks/useChartZoom';
import './MiniGraph.css';

export default function MiniGraph({ signals = [], unit = '', sessionData = [], liveSignals = {}, mode = 'live', replayPosition = null }) {

  const {
    zoomDomain, refAreaStart, refAreaEnd,
    onMouseDown, onMouseMove, onMouseUp,
    resetZoom, isZoomed,
  } = useChartZoom();

  // Build chart data from sessionData
  // Round timestamps to the nearest second so signals logged at slightly
  // different times (e.g. 18:01:44.478 vs 18:01:44.779) group together.
  const chartData = useMemo(() => {
    if (!sessionData.length || !signals.length) return [];

    const signalNames = signals.map(s => s.name);
    const relevantData = sessionData.filter(d => signalNames.includes(d.signal_name));

    // Group by rounded timestamp (nearest second)
    const byTimestamp = {};
    relevantData.forEach(d => {
      const rounded = new Date(Math.round(new Date(d.timestamp).getTime() / 1000) * 1000).toISOString();
      if (!byTimestamp[rounded]) {
        byTimestamp[rounded] = { timestamp: rounded };
      }
      byTimestamp[rounded][d.signal_name] = Number(d.value);
    });

    return Object.values(byTimestamp).sort((a, b) =>
      new Date(a.timestamp) - new Date(b.timestamp)
    );
  }, [sessionData, signals]);

  // Filter chart data through zoom domain
  const visibleChartData = useMemo(() => {
    if (!zoomDomain) return chartData;
    return chartData.filter(d => d.timestamp >= zoomDomain.left && d.timestamp <= zoomDomain.right);
  }, [chartData, zoomDomain]);

  // Compute cursor timestamp from chartData timestamps (rounded) to avoid mismatch
  const cursorTimestamp = useMemo(() => {
    if (mode !== 'replay' || replayPosition == null || !chartData.length) return null;
    // Get unique raw timestamps from sessionData for slider indexing
    const uniqueTimestamps = [...new Set(sessionData.map(d => d.timestamp))].sort();
    const rawTs = uniqueTimestamps[replayPosition];
    if (!rawTs) return null;
    // Round to match chartData timestamps
    const rounded = new Date(Math.round(new Date(rawTs).getTime() / 1000) * 1000).toISOString();
    // Verify it exists in chartData
    const match = chartData.find(d => d.timestamp === rounded);
    return match ? rounded : null;
  }, [mode, replayPosition, sessionData, chartData]);

  // Get cursor data point for ReferenceDots
  const cursorData = useMemo(() => {
    if (!cursorTimestamp) return null;
    return chartData.find(d => d.timestamp === cursorTimestamp) || null;
  }, [chartData, cursorTimestamp]);

  // Format timestamp for X axis
  const formatTime = (ts) => {
    try {
      return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  if (!signals.length) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
        color: 'rgba(255,255,255,0.3)',
      }}>
        No signals configured
      </div>
    );
  }

  return (
    <div className="minigraph-container">
      {isZoomed && (
        <button className="minigraph-reset-zoom" onClick={resetZoom}>
          Reset Zoom
        </button>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={visibleChartData}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          <CartesianGrid stroke="rgba(255,255,255,0.10)" strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTime}
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.45)' }}
            stroke="rgba(255,255,255,0.14)"
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.45)' }}
            stroke="rgba(255,255,255,0.14)"
            label={unit ? { value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'rgba(255,255,255,0.55)' } } : undefined}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(10,10,15,0.95)',
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: '4px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: '#f0f0f0',
            }}
            labelFormatter={formatTime}
          />
          {signals.map(signal => (
            <Line
              key={signal.name}
              type="monotone"
              dataKey={signal.name}
              stroke={signal.color}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
          {mode === 'replay' && cursorTimestamp && (
            <ReferenceLine
              x={cursorTimestamp}
              stroke="#4E2A84"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
          {mode === 'replay' && cursorData && signals.map(signal => {
            const value = cursorData[signal.name];
            if (value == null) return null;
            return (
              <ReferenceDot
                key={`cursor-${signal.name}`}
                x={cursorTimestamp}
                y={value}
                r={4}
                fill={signal.color}
                stroke="rgba(255,255,255,0.8)"
                strokeWidth={1}
              />
            );
          })}
          {refAreaStart && refAreaEnd && (
            <ReferenceArea
              x1={refAreaStart}
              x2={refAreaEnd}
              strokeOpacity={0.3}
              fill="rgba(78, 42, 132, 0.3)"
              fillOpacity={0.3}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
