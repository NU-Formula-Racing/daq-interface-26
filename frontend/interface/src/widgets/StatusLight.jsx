export default function StatusLight({ signalName = '', value = 0, threshold = 50, unit = '' }) {
  const isActive = value >= threshold;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
      padding: '12px',
      gap: '10px',
    }}>
      {/* Signal name */}
      <span style={{
        fontFamily: "var(--font-display)",
        fontSize: '0.65rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'rgba(255,255,255,0.9)',
      }}>
        {signalName}
      </span>

      {/* Light indicator */}
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        background: isActive ? '#4E2A84' : 'rgba(255,255,255,0.12)',
        border: `2px solid ${isActive ? '#a78bfa' : 'rgba(255,255,255,0.22)'}`,
        transition: 'all 0.3s ease',
      }} />

      {/* Current value */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '1.2rem',
        fontWeight: 600,
        color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.6)',
      }}>
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span style={{ fontSize: '0.75rem', marginLeft: '4px' }}>{unit}</span>}
      </span>

      {/* Threshold label */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65rem',
        color: 'rgba(255,255,255,0.55)',
      }}>
        THRESHOLD: {threshold}{unit ? ' ' + unit : ''}
      </span>
    </div>
  );
}
