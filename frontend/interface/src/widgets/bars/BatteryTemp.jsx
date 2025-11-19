export default function BatteryTemp({ temperature = 0 }) {

    // Determine color based on temperature
    const getColor = (temp) => {
        if (temp < 30) return "#5BE12C"; // Green
        if (temp < 45) return "#F5CD19"; // Yellow
        return "#EA4228"; // Red
    };

    const maxTemp = 60; // Li-ion safe upper bound
    const normalizedTemp = Math.min(temperature, maxTemp);
    const barHeight = 250; // Total height of the bar in pixels
    const fillPercentage = (normalizedTemp / maxTemp) * 100;

    const ticks = [60, 45, 30, 15, 0];

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            padding: '20px'
        }}>
            <div style={{
                fontSize: '2.0rem',
                fontWeight: 'bold',
                color: getColor(temperature),
                marginBottom: '15px'
            }}>
                {Math.round(temperature)}°C
            </div>

            {/* Custom vertical bar with ticks */}
            <div style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: '10px'
            }}>
                {/* Temperature ticks */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    height: `${barHeight}px`,
                    fontSize: '12px',
                    color: '#666'
                }}>
                    {ticks.map(tick => (
                        <div key={tick} style={{ lineHeight: '1' }}>
                            {tick}
                        </div>
                    ))}
                </div>

                {/* Vertical bar container */}
                <div style={{
                    position: 'relative',
                    width: '60px',
                    height: `${barHeight}px`,
                    background: '#e0e0e0',
                    borderRadius: '10px 10px 0 0',
                    overflow: 'hidden'
                }}>
                    {/* Filled portion */}
                    <div style={{
                        position: 'absolute',
                        bottom: 0,
                        width: '100%',
                        height: `${fillPercentage}%`,
                        background: getColor(temperature),
                        borderRadius: fillPercentage === 100 ? '10px 10px 0 0' : '0',
                        transition: 'height 0.3s ease, background 0.3s ease'
                    }} />
                </div>
            </div>

            <div style={{
                fontSize: '0.9rem',
                color: '#666',
                marginTop: '10px'
            }}>
                Max: {maxTemp}°C
            </div>
        </div>
    );
}
