import Navbar from '../components/navBar';
import BaseDashboard from "@/widgets/BaseDash";
import './Dash.css'
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css"; 
import GridLayout, { WidthProvider } from "react-grid-layout";
const ResponsiveGrid = WidthProvider(GridLayout);

export default function Dashboard() {
    // Define the layout for grid items
    const layout = [
        { i: 'basedash', x: 0, y: 0, w:6.5, h: 4, minW: 6.5, minH: 4 }
    ];

    return (
        <>
            <Navbar />
            <div style={{ padding: '20px' }}>
                <ResponsiveGrid
                    className="layout"
                    layout={layout}
                    cols={12}
                    rowHeight={100}
                    isDraggable={true}
                    isResizable={false}
                    draggableHandle=".drag-handle"
                >
                    <div key="basedash" className="base-dash-container" style={{ background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
                        <div className="drag-handle" style={{
                            cursor: 'move',
                            padding: '10px',
                            background: '#4E2A84',
                            color: 'white',
                            fontWeight: 'bold',
                            textAlign: 'center'
                        }}>
                            Inverter Information
                        </div>
                        <BaseDashboard />
                    </div>
                </ResponsiveGrid>
            </div>
        </>
    );
}