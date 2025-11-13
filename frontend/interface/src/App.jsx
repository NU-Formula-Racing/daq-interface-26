import './App.css'
import { Routes, Route } from 'react-router-dom';
import Dash from "./pages/Dash";
import Graph from "./pages/Graph";
import Map from "./pages/Map";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dash />} />
      <Route path="/graph" element={<Graph />} />
      <Route path="/map" element={<Map />} />
    </Routes>
  );
}

export default App
