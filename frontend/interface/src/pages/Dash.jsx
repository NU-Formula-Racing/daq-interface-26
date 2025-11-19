import { useState, useEffect, useRef } from 'react';
import { supabase } from "@/lib/supabaseClient";
import Navbar from '../components/navBar';
import BaseDashboard from "@/widgets/BaseDash";
import BatteryTemp from "@/widgets/bars/BatteryTemp";
import Sidebar from "@/widgets/Sidebar";
import './Dash.css';
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import GridLayout, { WidthProvider } from "react-grid-layout";
import MobileDashboard from "./MobileDashboard";
import useIsMobile from "@/hooks/useIsMobile";
import { Slider } from "@/components/ui/slider"

const ResponsiveGrid = WidthProvider(GridLayout);

const SIGNALS = ["Inverter_RPM", "IGBT_Temperature", "Battery_Temperature"];

// Widget registry
const widgetsList = [
    { id: 'basedash', label: 'Inverter Information', defaultW: 8, defaultH: 3.7 },
    { id: 'battery-temp', label: 'Battery Temperature', defaultW: 3, defaultH: 4 },
    { id: 'warning-lights', label: 'Warning Lights', defaultW: 4, defaultH: 2 },
    { id: 'temp-bars', label: 'Temperature Bars', defaultW: 4, defaultH: 3 },
];

export default function Dashboard() {
    const isMobile = useIsMobile();

    // Playback controls
    const [sessionData, setSessionData] = useState([]);
    const [sliderIndex, setSliderIndex] = useState(100);

    // Live values
    const [rpm, setRpm] = useState(0);
    const [igbtTemp, setIgbtTemp] = useState(0);
    const [batteryTemp, setBatteryTemp] = useState(0);

    // constantly update the slider index value
    // otherwise supabase real time starts with arbitrary
    const sliderRef = useRef(sliderIndex);
    const [channel, setChannel] = useState(null);

    useEffect(() => {
        sliderRef.current = sliderIndex;
    }, [sliderIndex]);

    // -------------------------------
    // Realtime Subscription Function
    // -------------------------------
    const startRealtime = () => {
        // 1. Clear all stale channels (prevents binding mismatch)
        supabase.getChannels().forEach((ch) => supabase.removeChannel(ch));

        // 2. Create a new clean channel
        const ch = supabase
            .channel("signals-stream")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "nfr26_signals",
                },
                (payload) => {
                    console.log("Realtime payload:", payload); // debug

                    const row = payload.new;

                    // ignore realtime if scrubbing
                    if (sliderRef.current !== 100) return;

                    if (row.signal_name === "Inverter_RPM") setRpm(row.value);
                    if (row.signal_name === "IGBT_Temperature") setIgbtTemp(row.value);
                    if (row.signal_name === "Battery_Temperature") setBatteryTemp(row.value);
                }
            )
            .subscribe((status) => console.log("SUB status:", status));

        return ch;
    };



    // -------------------------------
    // Fetch initial live values
    // -------------------------------
    const fetchInitialValues = async () => {
        const { data } = await supabase
            .from("nfr26_signals")
            .select("signal_name, value")
            .in("signal_name", SIGNALS)
            .order("timestamp", { ascending: false });

        if (!data) return;

        const rpmRow = data.find(d => d.signal_name === "Inverter_RPM");
        if (rpmRow) setRpm(rpmRow.value);

        const igbtRow = data.find(d => d.signal_name === "IGBT_Temperature");
        if (igbtRow) setIgbtTemp(igbtRow.value);

        const batRow = data.find(d => d.signal_name === "Battery_Temperature");
        if (batRow) setBatteryTemp(batRow.value);
    };

    // fetch the most recent signal ID
    // update sessionData stored in state
    // update sessionData stored in state
    const loadLatestSession = async () => {
        const { data: latest } = await supabase
            .from("nfr26_signals")
            .select("session_id")
            .order("timestamp", { ascending: false })
            .limit(1);  // removed .single()

        if (!latest || latest.length === 0) return;

        const latestRow = latest[0]; // extract first

        // CASE 1: session_id is NULL → treat as "session 0"
        if (latestRow.session_id === null) {
            const { data: sessionRows } = await supabase
                .from("nfr26_signals")
                .select("*")
                .is("session_id", null)        // fetch all null session rows
                .order("timestamp", { ascending: true });

            setSessionData(sessionRows || []);
            return;
        }

        // CASE 2: normal session_id
        const { data: sessionRows } = await supabase
            .from("nfr26_signals")
            .select("*")
            .eq("session_id", latestRow.session_id)
            .order("timestamp", { ascending: true });

        setSessionData(sessionRows || []);
    };



    // load latest session data
    // then start the realtime updates
    useEffect(() => {
        let ch;

        const init = async () => {
            await fetchInitialValues();   // load live values
            await loadLatestSession();    // load session for playback
            ch = startRealtime();         // start realtime subscription
            setChannel(ch);
        };

        init();

        // Cleanup: unsubscribe on unmount
        return () => {
            if (ch) {
                supabase.removeChannel(ch);
            }
        };
    }, []);


    // get data value based on slider index
    const getScrubValue = (signalName) => {
        if (sliderIndex === 100) return null; // live mode

        if (!sessionData.length) return null;

        const items = sessionData.filter(x => x.signal_name === signalName);
        if (!items.length) return null;

        const idx = Math.floor((sliderIndex / 100) * (items.length - 1));
        return items[idx]?.value ?? null;
    };


    // Which values should the widgets use?
    const scrubRpm = getScrubValue("Inverter_RPM");
    const scrubIgbt = getScrubValue("IGBT_Temperature");
    const scrubBat = getScrubValue("Battery_Temperature");

    const rpmValue = scrubRpm ?? rpm;
    const igbtValue = scrubIgbt ?? igbtTemp;
    const batValue = scrubBat ?? batteryTemp;


    // -------------------------------
    // Widget Logic
    // -------------------------------
    const [widgets, setWidgets] = useState([
        { i: 'basedash-1', x: 0, y: 0, w: 8, h: 3.7, minW: 8, minH: 3.7, type: 'basedash' },
        { i: 'battery-temp-1', x: 8, y: 0, w: 3, h: 4, minW: 3, minH: 4, type: 'battery-temp' }
    ]);

    if (isMobile) return <MobileDashboard />;

    const handleToggleWidget = (widgetId) => {
        const exists = widgets.some(w => w.type === widgetId);
        if (exists) {
            setWidgets(widgets.filter(w => w.type !== widgetId));
        } else {
            const widgetConfig = widgetsList.find(w => w.id === widgetId);
            setWidgets([
                ...widgets,
                {
                    i: `${widgetId}-${Date.now()}`,
                    x: 0,
                    y: Infinity,
                    w: widgetConfig.defaultW,
                    h: widgetConfig.defaultH,
                    type: widgetId
                }
            ]);
        }
    };

    const handleLayoutChange = (newLayout) => {
        setWidgets(widgets.map((widget) => {
            const layoutItem = newLayout.find(item => item.i === widget.i);
            return layoutItem ? { ...widget, ...layoutItem } : widget;
        }));
    };

    const renderWidget = (widget) => {
        switch (widget.type) {
            case 'basedash':
                return <BaseDashboard rpm={rpmValue} igbtTemp={igbtValue} />;

            case 'battery-temp':
                return <BatteryTemp temperature={batValue} />;

            case 'warning-lights':
                return <div style={{ padding: 20 }}>Warning Lights (Coming Soon)</div>;

            case 'temp-bars':
                return <div style={{ padding: 20 }}>Temperature Bars (Coming Soon)</div>;

            default:
                return <div>Unknown widget</div>;
        }
    };

    // -------------------------------
    // Render
    // -------------------------------
    return (
        <>
            <Navbar />
            <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>

                <Sidebar
                    widgets={widgets}
                    onToggleWidget={handleToggleWidget}
                />

                <div className="main-content">
                    <div className="slider-container">
                        <h2>SLIDERRERRKLJEKLR</h2>
                        <Slider
                            value={[sliderIndex]}
                            onValueChange={(v) => setSliderIndex(v[0])}
                            min={0}
                            max={100}
                            step={1}
                        />

                        <p className="slider-helper">
                            {sliderIndex === 100
                                ? "Currently viewing LIVE data"
                                : "Viewing replay data at position " + sliderIndex}
                        </p>
                    </div>


                    <div style={{ flex: 1, padding: 10, overflow: 'auto' }}>
                        <ResponsiveGrid
                            className="layout"
                            layout={widgets}
                            onLayoutChange={handleLayoutChange}
                            cols={12}
                            rowHeight={100}
                            isDraggable={true}
                            isResizable={true}
                            draggableHandle=".drag-handle"
                        >
                            {widgets.map(widget => (
                                <div
                                    key={widget.i}
                                    className="widget-container"
                                    style={{
                                        background: 'white',
                                        borderRadius: 8,
                                        overflow: 'hidden',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                    }}
                                >
                                    <div
                                        className="drag-handle"
                                        style={{
                                            cursor: 'move',
                                            padding: 10,
                                            background: '#4E2A84',
                                            color: 'white',
                                            fontWeight: 'bold',
                                            textAlign: 'center'
                                        }}
                                    >
                                        {widgetsList.find(w => w.id === widget.type)?.label}
                                    </div>

                                    {renderWidget(widget)}
                                </div>
                            ))}
                        </ResponsiveGrid>
                    </div>
                </div>
            </div>
        </>
    );
}
