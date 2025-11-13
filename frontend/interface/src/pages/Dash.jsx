import Navbar from '../components/navBar';
import './Dash.css';

function Dash() {
  return (
    <>
      <Navbar />
      <div className="dashboard">
        <h1>Dashboard</h1>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h2>System Status</h2>
            <div className="status-indicator">
              <span className="status-dot active"></span>
              <span>Online</span>
            </div>
          </div>

          <div className="dashboard-card">
            <h2>Data Points</h2>
            <div className="stat-value">1,234</div>
            <div className="stat-label">Total Records</div>
          </div>

          <div className="dashboard-card">
            <h2>Inverter RPM</h2>
            <div className="stat-value">3,450</div>
            <div className="stat-label">Current Reading</div>
          </div>

          <div className="dashboard-card">
            <h2>Battery Temperature</h2>
            <div className="stat-value">72�F</div>
            <div className="stat-label">Current Reading</div>
          </div>
        </div>

        <div className="dashboard-section">
          <h2>Quick Actions</h2>
          <div className="action-buttons">
            <button className="action-btn">View Graphs</button>
            <button className="action-btn">Export Data</button>
            <button className="action-btn">Settings</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default Dash;
