import './BaseDash.css';
import InverterRPMGauge from "@/widgets/gauges/InverterRPMGauge";
import IgbtTempGauge from "@/widgets/gauges/IgbtTempGauge";

export default function BaseDashboard() {
    // Placeholder values - replace with actual data
    const motorTemp = 85; // degrees
    const maxTemp = 120;
    const motorTempPercent = (motorTemp / maxTemp) * 100;

    return (
        <div className="base-dashboard">
            {/* RPM Gauge - Left */}
            <section className="gauge rpm-gauge">
                <InverterRPMGauge rpm={3200} />
            </section>

            {/* Motor Temperature - Middle (Tall Thin Bar) */}
            <section className="center-bar motor-temp">
                <div className="motor-temp-label">Motor Temp</div>
                <div className="motor-temp-bar">
                    <div className="motor-temp-fill" style={{ height: `${motorTempPercent}%` }}></div>
                </div>
                <div className="motor-temp-value">{motorTemp}°C</div>
            </section>

            
            {/* IGBT Temperature - Right */}
            <section className="gauge igbt-temp">
                <IgbtTempGauge temp={60} />
            </section>
        </div>
    );
}
