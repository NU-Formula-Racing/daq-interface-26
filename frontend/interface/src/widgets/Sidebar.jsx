import './Sidebar.css';

const widgetsList = [
    { id: 'basedash', label: 'Inverter Information', defaultW: 8, defaultH: 3.7 },
    { id: 'battery-temp', label: 'Battery Temperature', defaultW: 3, defaultH: 4 },
    { id: 'warning-lights', label: 'Warning Lights', defaultW: 4, defaultH: 2 },
    { id: 'temp-bars', label: 'Temperature Bars', defaultW: 4, defaultH: 3 },
];

export default function Sidebar({ widgets, onToggleWidget, isPlayback, onTogglePlayback }) {
    return (
        <div className="sidebar">
            <h2>Dashboard Widgets</h2>
            {widgetsList.map(w => {
                const active = widgets.some(i => i.type === w.id);

                return (
                    <div key={w.id} className="sidebar-item">
                        <span>{w.label}</span>

                        <button
                            className={active ? 'active' : ''}
                            onClick={() => onToggleWidget(w.id)}
                        >
                            {active ? "Remove" : "Add"}
                        </button>
                    </div>
                );
            })}

            <button
                style={{
                    marginTop: "20px",
                    padding: "10px",
                    background: isPlayback ? "#4E2A84" : "green",
                    color: "white",
                    width: "100%",
                    borderRadius: "6px"
                }}
                onClick={onTogglePlayback}
            >
                {isPlayback ? "Playback Mode" : "Live Mode"}
            </button>
        </div>
    );
}