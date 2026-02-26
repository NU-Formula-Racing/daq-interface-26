export default function Readout({ signalName = '', value = 0, unit = '', previousValue = null }) {
  // Determine trend
  let trend = null;
  if (previousValue != null && value !== previousValue) {
    trend = value > previousValue ? 'up' : 'down';
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
      padding: '12px',
      gap: '4px',
    }}>
      {/* Signal name */}
      <span style={{
        fontFamily: "var(--font-display)",
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.9)',
      }}>
        {signalName}
      </span>

      {/* Value with trend arrow */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '2.5rem',
          fontWeight: 700,
          color: '#f0f0f0',
          lineHeight: 1,
        }}>
          {typeof value === 'number' ? value.toFixed(1) : value}
        </span>

        {/* Trend arrow */}
        {trend && (
          <span style={{
            fontSize: '1.2rem',
            color: trend === 'up' ? '#4ade80' : '#fb7185',
            lineHeight: 1,
          }}>
            {trend === 'up' ? '\u25B2' : '\u25BC'}
          </span>
        )}
      </div>

      {/* Unit label */}
      {unit && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'rgba(255,255,255,0.7)',
          textTransform: 'uppercase',
        }}>
          {unit}
        </span>
      )}
    </div>
  );
}
