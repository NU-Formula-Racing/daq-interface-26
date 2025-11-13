import './App.css'
import Navbar from './components/navBar';
import SignalChart from "./components/SignalChart";

function App() {
  return (
    <>
      <Navbar />
      <SignalChart signalName="Inverter_RPM" color="#ef4444" />
    </>
  )
}

export default App
