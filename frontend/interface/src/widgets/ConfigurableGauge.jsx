import GaugeComponent from "react-gauge-component";

export default function ConfigurableGauge({ signalName, value = 0, unit = '', min = 0, max = 100 }) {
  const normalizedValue = Math.min(Math.max(value, min), max);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      width: '100%',
      padding: '8px',
    }}>
      <h3 style={{
        fontFamily: "var(--font-display)",
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'rgba(255,255,255,0.9)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        margin: '0 0 4px 0',
      }}>
        {signalName}
      </h3>
      <div style={{ width: '100%', maxWidth: '300px', aspectRatio: '4/3' }}>
        <GaugeComponent
          arc={{
            nbSubArcs: 100,
            colorArray: ['#a78bfa', '#facc15', '#fb7185'],
            width: 0.3,
            padding: 0.003,
          }}
          labels={{
            valueLabel: {
              style: { fontSize: 35, fill: '#f0f0f0' },
              formatTextValue: (v) => `${Math.round(v)}${unit ? ' ' + unit : ''}`,
            },
            tickLabels: {
              type: 'outer',
              defaultTickValueConfig: {
                style: { fill: 'rgba(255,255,255,0.7)' },
              },
            },
          }}
          value={normalizedValue}
          minValue={min}
          maxValue={max}
        />
      </div>
    </div>
  );
}
