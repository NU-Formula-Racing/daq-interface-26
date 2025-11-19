import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import "./MobileDashboard.css";
import logo from '../assets/nfr_logo.png';

export default function MobileDashboard() {
    const [signals, setSignals] = useState({});

    useEffect(() => {
        const fetchInitial = async () => {
            const { data } = await supabase
                .from("nfr26_signals")
                .select("signal_name, value")
                .order("timestamp", { ascending: false });

            if (!data) return;
            const latest = {};
            data.forEach(d => latest[d.signal_name] = d.value);
            setSignals(latest);
        };

        fetchInitial();

        // realtime
        const channel = supabase
            .channel("mobile-stream")
            .on("postgres_changes",
                { event: "INSERT", schema: "public", table: "nfr26_signals" },
                (payload) => {
                    const { signal_name, value } = payload.new;
                    setSignals(prev => ({ ...prev, [signal_name]: value }));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    return (
        <div className="mobile-container">
            <header className="mobile-header">
                <img src={logo} alt="Logo" className="logo" />
                <h1>NU Formula Racing</h1>
            </header>

            <section className="mobile-signal-list">
                {Object.entries(signals).map(([name, value]) => (
                    <div key={name} className="signal-row">
                        <span className="signal-name">{name}</span>
                        <span className="signal-value">{value}</span>
                    </div>
                ))}
            </section>
        </div>
    );
}
