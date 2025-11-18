import { useState, useEffect } from 'react';
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
    const [isPlayback, setIsPlayback] = useState(false);
    const [sliderIndex, setSliderIndex] = useState(0);
    const [playbackData, setPlaybackData] = useState([]);
    const [channel, setChannel] = useState(null);

    // Live values
    const [rpm, setRpm] = useState(0);
    const [igbtTemp, setIgbtTemp] = useState(0);
    const [batteryTemp, setBatteryTemp] = useState(0);

    // -------------------------------
    // Realtime Subscription Function
    // -------------------------------
    const startRealtime = () => {
        const ch = supabase
            .channel("signals-stream")
            .on(
                "postgres_changes",
                { event: "INSERT", schema: "public", table: "nfr26_signals" },
                (payload) => {
                    if (isPlayback) return; // Ignore during playback

                    const row = payload.new;

                    if (row.signal_name === "Inverter_RPM") setRpm(row.value);
                    if (row.signal_name === "IGBT_Temperature") setIgbtTemp(row.value);
                    if (row.signal_name === "Battery_Temperature") setBatteryTemp(row.value);
                }
            )
            .subscribe();

        return ch;
    };

    // -------------------------------
    // Fetch initial live values
    // -------------------------------
    useEffect(() => {
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

        fetchInitialValues();
        setChannel(startRealtime());
    }, []);

    // -------------------------------
    // Fetch playback window (last 100 seconds)
    // -------------------------------
    const fetchPlaybackWindow = async () => {
        const since = new Date(Date.now() - 100 * 1000).toISOString();

        const { data } = await supabase
            .from("nfr26_signals")
            .select("*")
            .gte("timestamp", since)
            .order("timestamp", { ascending: true });

        if (data) {
            setPlaybackData(data);
            setSliderIndex(data.length - 1); // start at newest
        }
    };

    // -------------------------------
    // Handle playback toggle
    // -------------------------------
    useEffect(() => {
        if (isPlayback) {
            if (channel) supabase.removeChannel(channel);
            fetchPlaybackWindow();
        } else {
            const newCh = startRealtime();
            setChannel(newCh);
            setPlaybackData([]);
        }
    }, [isPlayback]);

    // -------------------------------
    // Select value from playbackData based on slider
    // -------------------------------
    const getPlaybackValue = (signalName) => {
        const items = playbackData.filter(x => x.signal_name === signalName);
        if (!items.length) return null;
        return items[Math.min(sliderIndex, items.length - 1)]?.value ?? null;
    };

    // Which values should the widgets use?
    const rpmValue = isPlayback ? getPlaybackValue("Inverter_RPM") ?? rpm : rpm;
    const igbtValue = isPlayback ? getPlaybackValue("IGBT_Temperature") ?? igbtTemp : igbtTemp;
    const batValue = isPlayback ? getPlaybackValue("Battery_Temperature") ?? batteryTemp : batteryTemp;

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
                    isPlayback={isPlayback}
                    onTogglePlayback={() => setIsPlayback(prev => !prev)}
                />

                <div className="main-content">

                    {isPlayback && playbackData.length === 0 && (
                        <div style={{
                            padding: '20px',
                            textAlign: 'center',
                            background: '#fff3cd',
                            border: '1px solid #ffc107',
                            borderRadius: '8px',
                            margin: '10px',
                            color: '#856404'
                        }}>
                            No playback data available for the last 100 seconds
                        </div>
                    )}

                    {isPlayback && playbackData.length > 0 && (
                        <div className="slider-container">
                            <Slider
                                value={[sliderIndex]}
                                onValueChange={(v) => setSliderIndex(v[0])}
                                max={Math.max(0, playbackData.length - 1)}
                                min={0}
                                step={1}
                            />
                        </div>
                    )}

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
