import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { Slider } from "@/components/ui/slider";

const ResponsiveGrid = WidthProvider(GridLayout);

const SIGNALS = ["Inverter_RPM", "IGBT_Temperature", "Battery_Temperature"];

// Widget registry
const widgetsList = [
    { id: 'basedash', label: 'Inverter Information', defaultW: 8, defaultH: 3.7 },
    { id: 'battery-temp', label: 'Battery Temperature', defaultW: 3, defaultH: 4 },
    { id: 'warning-lights', label: 'Warning Lights', defaultW: 4, defaultH: 2 },
    { id: 'temp-bars', label: 'Temperature Bars', defaultW: 4, defaultH: 3 },
];

export default function ReplayDash() {
    const isMobile = useIsMobile();
    const location = useLocation();
    const navigate = useNavigate();

    // Get initial params from navigation state or use defaults
    const initialParams = location.state || {
        selectedDate: new Date().toISOString().split('T')[0],
        dataSource: 'wireless',
        sessionId: null
    };

    // Replay controls
    const [selectedDate, setSelectedDate] = useState(initialParams.selectedDate);
    const [dataSource, setDataSource] = useState(initialParams.dataSource);
    const [sessionId, setSessionId] = useState(initialParams.sessionId);
    const [availableSessions, setAvailableSessions] = useState([]);

    // Playback controls
    const [sessionData, setSessionData] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    // Display values
    const [rpm, setRpm] = useState(0);
    const [igbtTemp, setIgbtTemp] = useState(0);
    const [batteryTemp, setBatteryTemp] = useState(0);

    // Get unique timestamps to determine slider range
    const getUniqueTimestamps = (data) => {
        const timestamps = [...new Set(data.map(d => d.timestamp))];
        return timestamps.sort();
    };

    const uniqueTimestamps = getUniqueTimestamps(sessionData);
    const maxSliderValue = Math.max(0, uniqueTimestamps.length - 1);

    // -------------------------------
    // Fetch available sessions for selected date
    // -------------------------------
    const fetchAvailableSessions = async (date, source) => {
        // Convert date to timestamp range (start and end of day)
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const { data, error } = await supabase
            .from("nfr26_signals")
            .select("session_id")
            .gte("timestamp", startOfDay.toISOString())
            .lte("timestamp", endOfDay.toISOString())
            .not("session_id", "is", null)
            .order("session_id", { ascending: true });

        if (error) {
            console.error("Error fetching sessions:", error);
            return;
        }

        // Get unique session IDs
        const uniqueSessions = [...new Set(data.map(row => row.session_id))];
        setAvailableSessions(uniqueSessions);

        // If no session selected yet, select the first one
        if (!sessionId && uniqueSessions.length > 0) {
            setSessionId(uniqueSessions[0]);
        }
    };

    // -------------------------------
    // Load session data based on filters
    // -------------------------------
    const loadSessionData = async (date, source, session) => {
        if (!session) {
            setSessionData([]);
            return;
        }

        const { data: sessionRows, error } = await supabase
            .from("nfr26_signals")
            .select("*")
            .eq("session_id", session)
            .order("timestamp", { ascending: true });

        if (error) {
            console.error("Error loading session data:", error);
            return;
        }

        setSessionData(sessionRows || []);

        // Set initial values from first data point
        if (sessionRows && sessionRows.length > 0) {
            const rpmRow = sessionRows.find(d => d.signal_name === "Inverter_RPM");
            if (rpmRow) setRpm(rpmRow.value);

            const igbtRow = sessionRows.find(d => d.signal_name === "IGBT_Temperature");
            if (igbtRow) setIgbtTemp(igbtRow.value);

            const batRow = sessionRows.find(d => d.signal_name === "Battery_Temperature");
            if (batRow) setBatteryTemp(batRow.value);
        }
    };

    // Load data when filters change
    useEffect(() => {
        fetchAvailableSessions(selectedDate, dataSource);
    }, [selectedDate, dataSource]);

    useEffect(() => {
        if (sessionId) {
            loadSessionData(selectedDate, dataSource, sessionId);
            setCurrentIndex(0); // Reset to start when loading new session
        }
    }, [sessionId, selectedDate, dataSource]);

    // -------------------------------
    // Get data value based on current timestamp index
    // -------------------------------
    const getValueAtIndex = (signalName) => {
        if (!sessionData.length || currentIndex >= uniqueTimestamps.length) return null;

        const currentTimestamp = uniqueTimestamps[currentIndex];
        const dataPoint = sessionData.find(
            d => d.signal_name === signalName && d.timestamp === currentTimestamp
        );

        return dataPoint?.value ?? null;
    };

    // Update display values when slider moves
    useEffect(() => {
        if (sessionData.length > 0 && currentIndex < uniqueTimestamps.length) {
            const rpmValue = getValueAtIndex("Inverter_RPM");
            const igbtValue = getValueAtIndex("IGBT_Temperature");
            const batValue = getValueAtIndex("Battery_Temperature");

            if (rpmValue !== null) setRpm(rpmValue);
            if (igbtValue !== null) setIgbtTemp(igbtValue);
            if (batValue !== null) setBatteryTemp(batValue);
        }
    }, [currentIndex, sessionData]);

    // Which values should the widgets use?
    const rpmValue = rpm;
    const igbtValue = igbtTemp;
    const batValue = batteryTemp;

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
                    {/* Replay Controls */}
                    <div className="replay-controls" style={{
                        padding: '1rem',
                        background: '#f5f5f5',
                        borderRadius: '8px',
                        marginBottom: '1rem',
                        display: 'flex',
                        gap: '1rem',
                        flexWrap: 'wrap',
                        alignItems: 'flex-end'
                    }}>
                        <div style={{ flex: '1', minWidth: '200px' }}>
                            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', color: '#333' }}>
                                Date
                            </label>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '2px solid #e0e0e0',
                                    borderRadius: '6px',
                                    fontSize: '0.9rem'
                                }}
                            />
                        </div>

                        <div style={{ flex: '1', minWidth: '200px' }}>
                            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', color: '#333' }}>
                                Data Source
                            </label>
                            <select
                                value={dataSource}
                                onChange={(e) => setDataSource(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '2px solid #e0e0e0',
                                    borderRadius: '6px',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <option value="wireless">Wireless</option>
                                <option value="sd">SD Card</option>
                            </select>
                        </div>

                        <div style={{ flex: '1', minWidth: '200px' }}>
                            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', color: '#333' }}>
                                Session ID
                            </label>
                            <select
                                value={sessionId || ''}
                                onChange={(e) => setSessionId(e.target.value)}
                                disabled={availableSessions.length === 0}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    border: '2px solid #e0e0e0',
                                    borderRadius: '6px',
                                    fontSize: '0.9rem',
                                    background: availableSessions.length === 0 ? '#f0f0f0' : 'white'
                                }}
                            >
                                {availableSessions.length === 0 ? (
                                    <option>No sessions available</option>
                                ) : (
                                    availableSessions.map(session => (
                                        <option key={session} value={session}>
                                            Session {session}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.85rem', color: '#666' }}>
                                {sessionData.length} data points • {uniqueTimestamps.length} timestamps
                            </span>
                        </div>
                    </div>

                    {/* Playback Slider */}
                    <div className="slider-container">
                        <h2>Session Playback</h2>
                        <Slider
                            value={[currentIndex]}
                            onValueChange={(v) => setCurrentIndex(v[0])}
                            min={0}
                            max={maxSliderValue}
                            step={1}
                            disabled={sessionData.length === 0}
                        />

                        <p className="slider-helper">
                            {sessionData.length === 0
                                ? "No data available for this session"
                                : `Timestamp ${currentIndex + 1} of ${uniqueTimestamps.length} ${uniqueTimestamps[currentIndex] ? `(${new Date(uniqueTimestamps[currentIndex]).toLocaleTimeString()})` : ''}`}
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
