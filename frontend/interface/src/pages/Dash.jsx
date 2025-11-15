import { useState } from 'react';
import Navbar from '../components/navBar';
import BaseDashboard from "@/widgets/BaseDash";
import Sidebar from "@/widgets/Sidebar";
import './Dash.css'
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import GridLayout, { WidthProvider } from "react-grid-layout";

const ResponsiveGrid = WidthProvider(GridLayout);

// Widget registry - maps widget types to components
const widgetsList = [
    { id: 'basedash', label: 'Inverter Information', defaultW: 8, defaultH: 3 },
    { id: 'warning-lights', label: 'Warning Lights', defaultW: 4, defaultH: 2 },
    { id: 'temp-bars', label: 'Temperature Bars', defaultW: 4, defaultH: 3 },
];

export default function Dashboard() {
    // State to track active widgets and their positions
    const [widgets, setWidgets] = useState([
        { i: 'basedash-1', x: 0, y: 0, w: 8, h: 3, minW: 8, minH: 3, type: 'basedash' }
    ]);

    // Toggle widget on/off
    const handleToggleWidget = (widgetId) => {
        const exists = widgets.some(w => w.type === widgetId);

        if (exists) {
            // Remove all instances of this widget type
            setWidgets(widgets.filter(w => w.type !== widgetId));
        } else {
            // Add widget with default position
            const widgetConfig = widgetsList.find(w => w.id === widgetId);
            const newWidget = {
                i: `${widgetId}-${Date.now()}`, // unique key
                x: 0,
                y: Infinity, // puts it at the bottom
                w: widgetConfig.defaultW,
                h: widgetConfig.defaultH,
                type: widgetId
            };
            setWidgets([...widgets, newWidget]);
        }
    };

    // Handle layout changes when user drags/resizes widgets
    const handleLayoutChange = (newLayout) => {
        setWidgets(widgets.map((widget) => {
            const layoutItem = newLayout.find(item => item.i === widget.i);
            return layoutItem ? { ...widget, ...layoutItem } : widget;
        }));
    };

    // Render the appropriate component based on widget type
    const renderWidget = (widget) => {
        switch(widget.type) {
            case 'basedash':
                return <BaseDashboard />;
            case 'warning-lights':
                return <div style={{ padding: '20px', textAlign: 'center' }}>Warning Lights (Coming Soon)</div>;
            case 'temp-bars':
                return <div style={{ padding: '20px', textAlign: 'center' }}>Temperature Bars (Coming Soon)</div>;
            default:
                return <div>Unknown widget</div>;
        }
    };

    return (
        <>
            <Navbar />
            <div style={{ display: 'flex', height: 'calc(100vh - 62px)' }}>
                {/* Sidebar */}
                <Sidebar
                    widgets={widgets}
                    onToggleWidget={handleToggleWidget}
                />

                {/* Grid Dashboard */}
                <div style={{ flex: 1, padding: '10px', overflow: 'auto' }}>
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
                                    borderRadius: '8px',
                                    overflow: 'hidden',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                                }}
                            >
                                <div
                                    className="drag-handle"
                                    style={{
                                        cursor: 'move',
                                        padding: '10px',
                                        background: '#4E2A84',
                                        color: 'white',
                                        fontWeight: 'bold',
                                        textAlign: 'center',
                                        flexShrink: 0
                                    }}
                                >
                                    {widgetsList.find(w => w.id === widget.type)?.label || 'Unknown Widget'}
                                </div>
                                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                                    {renderWidget(widget)}
                                </div>
                            </div>
                        ))}
                    </ResponsiveGrid>
                </div>
            </div>
        </>
    );
}