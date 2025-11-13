import GaugeComponent from "react-gauge-component";

export default function IgbtTempGauge({ temp }) {
    const maxTemp = 140; // Typical IGBT safe upper bound

    return (
        <div
            style={{
                width: "600px",
                height: "320px",
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
                    colorArray: ["#5BE12C", "#F5CD19", "#EA4228"], // Green → Yellow → Red
                    width: 0.3,
                    padding: 0.003,
                }}
                labels={{
                    valueLabel: {
                        style: { fontSize: 40 },
                        formatTextValue: (value) => `${Math.round(value)}°C`,
                    },
                    tickLabels: {
                        type: "outer",
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
