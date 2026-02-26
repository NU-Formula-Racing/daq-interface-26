import './BaseDash.css';
import InverterRPMGauge from "@/widgets/gauges/InverterRPMGauge";
import IgbtTempGauge from "@/widgets/gauges/IgbtTempGauge";

export default function BaseDashboard({ rpm = 0, igbtTemp = 0 }) {

    return (
        <div className="base-dashboard">
            <div className="gauges-container">
                {/* RPM Gauge - Left */}
                <section className="gauge rpm-gauge">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'rgba(255,255,255,0.7)', fontFamily: "'Space Grotesk', sans-serif", margin: 0 }}>
                            Inverter RPM
                        </h3>
                        <InverterRPMGauge rpm={rpm ?? 0} />
                    </div>
                </section>

                {/* IGBT Temperature - Right */}
                <section className="gauge igbt-temp">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'rgba(255,255,255,0.7)', fontFamily: "'Space Grotesk', sans-serif", margin: 0 }}>
                            IGBT Temperature
                        </h3>
                        <IgbtTempGauge temp={igbtTemp ?? 0} />
                    </div>
                </section>
            </div>
        </div>
    );
}
