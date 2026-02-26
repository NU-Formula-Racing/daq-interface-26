import GaugeComponent from "react-gauge-component";

export default function InverterRPMGauge({ rpm }) {
    const rpmScaled = rpm / 100; // Scale RPM down by 100

    return (
        <div style={{
            width: '400px',
            height: '300px',
            justifyContent: 'center',
            alignItems: 'center'
        }}>
            <GaugeComponent
                arc={{
                    nbSubArcs: 150,
                    colorArray: ['#a78bfa', '#facc15', '#fb7185'],
                    width: 0.3,
                    padding: 0.003
                }}
                labels={{
                    valueLabel: {
                        style: { fontSize: 40, fill: '#f0f0f0' },
                        formatTextValue: (value) => `${Math.round(value * 100)} RPM`
                    },
                    tickLabels: {
                        type: "outer",
                        defaultTickValueConfig: {
                            style: { fill: 'rgba(255,255,255,0.5)' }
                        },
                        ticks: [
                            { value: 0 },
                            { value: 10 },
                            { value: 20 },
                            { value: 30 },
                            { value: 40 },
                            { value: 50 },
                            { value: 60 },
                            { value: 70 },
                            { value: 80 },
                            { value: 90 },
                            { value: 100 },
                            { value: 110 },
                            { value: 120 },
                            { value: 130 },
                            { value: 140 },
                        ]
                    }
                }}
                value={rpmScaled}
                maxValue={140}
            />
        </div>
    );
}
