import './App.css'
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from './pages/Home';
import Dash from './pages/Dash';
import Replay from './pages/Replay';
import Graphs from './pages/Graphs';
import TopBar from './components/TopBar';

function PageWrapper({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{ height: '100%' }}
    >
      {children}
    </motion.div>
  );
}

function App() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <>
      {!isHome && <TopBar />}
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<PageWrapper><Home /></PageWrapper>} />
          <Route path="/dashboard" element={<PageWrapper><Dash /></PageWrapper>} />
          <Route path="/replay" element={<PageWrapper><Replay /></PageWrapper>} />
          <Route path="/graphs" element={<PageWrapper><Graphs /></PageWrapper>} />
        </Routes>
      </AnimatePresence>
    </>
  );
}

export default App
