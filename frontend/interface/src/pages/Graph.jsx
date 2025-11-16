import Navbar from '../components/navBar';
import SignalChart from "../components/SignalChart";
import './Graph.css';

function Graph() {
  return (
    <>
      <Navbar />
      <div className="charts">
        <SignalChart signalName="Inverter_RPM" color="#ef4444" />
        <SignalChart signalName="Battery_Temperature" color="#4E2A84" />
      </div>
    </>
  )
}

export default Graph