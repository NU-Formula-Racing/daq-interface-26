import GaugeComponent from "react-gauge-component";

export default function IgbtTempGauge({ temp }) {
    const maxTemp = 140; // Typical IGBT safe upper bound

    return (
        <div
            style={{
                width: "400px",
                height: "300px",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <GaugeComponent
                value={temp}
                minValue={0}
                maxValue={maxTemp}
                arc={{
                    nbSubArcs: 150,
                    colorArray: ["#a78bfa", "#facc15", "#fb7185"],
                    width: 0.3,
                    padding: 0.003,
                }}
                labels={{
                    valueLabel: {
                        style: { fontSize: 40, fill: '#f0f0f0' },
                        formatTextValue: (value) => `${Math.round(value)}°C`,
                    },
                    tickLabels: {
                        type: "outer",
                        defaultTickValueConfig: {
                            style: { fill: 'rgba(255,255,255,0.5)' }
                        },
                        ticks: [
                            { value: 0 },
                            { value: 20 },
                            { value: 40 },
                            { value: 60 },
                            { value: 80 },
                            { value: 100 },
                            { value: 120 },
                            { value: 140 },
                        ],
                    },
                }}
            />
        </div>
    );
}
