import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import './BaseDash.css';
import InverterRPMGauge from "@/widgets/gauges/InverterRPMGauge";
import IgbtTempGauge from "@/widgets/gauges/IgbtTempGauge";

export default function BaseDashboard() {
    const [rpm, setRpm] = useState(0);
    const [igbtTemp, setIgbtTemp] = useState(0);

    useEffect(() => {
        // fetch latest values (ascending false)
        const fetchInitialValues = async () => {
            const { data } = await supabase
                .from("nfr26_signals")
                .select("signal_name, value")
                .in("signal_name", ["Inverter_RPM", "IGBT_Temperature"])
                .order("timestamp", { ascending: false });

            if (!data) return;

            // find latest rpm
            const rpmRow = data.find(d => d.signal_name === "Inverter_RPM");
            if (rpmRow) setRpm(rpmRow.value);

            // find latest temp
            const tempRow = data.find(d => d.signal_name === "IGBT_Temperature");
            if (tempRow) setIgbtTemp(tempRow.value);
        };

        fetchInitialValues();

        // real time updates
        const channel = supabase
            .channel("signals-stream")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "nfr26_signals"
                },
                (payload) => {
                    const row = payload.new;

                    if (row.signal_name === "Inverter_RPM") {
                        setRpm(row.value);
                    }

                    if (row.signal_name === "IGBT_Temperature") {
                        setIgbtTemp(row.value);
                    }
                }
            )
            .subscribe();

        // cleanup
        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <div className="base-dashboard">
            <div className="gauges-container">
                {/* RPM Gauge - Left */}
                <section className="gauge rpm-gauge">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4E2A84', margin: 0 }}>
                            Inverter RPM
                        </h3>
                        <InverterRPMGauge rpm={rpm ?? 0} />
                    </div>
                </section>

                {/* IGBT Temperature - Right */}
                <section className="gauge igbt-temp">
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#4E2A84', margin: 0 }}>
                            IGBT Temperature
                        </h3>
                        <IgbtTempGauge temp={igbtTemp ?? 0} />
                    </div>
                </section>
            </div>
        </div>
    );
}
