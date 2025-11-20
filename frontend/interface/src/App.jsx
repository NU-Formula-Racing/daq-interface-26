import './App.css'
import { Routes, Route } from 'react-router-dom';
import Dash from "./pages/Dash";
import ReplayDash from "./pages/ReplayDash";
import Graph from "./pages/Graph";
import Map from "./pages/Map";
import Home from"./pages/Home";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/dash" element={<Dash />} />
      <Route path="/replay" element={<ReplayDash />} />
      <Route path="/graph" element={<Graph />} />
      <Route path="/map" element={<Map />} />
    </Routes>
  );
}

export default App
