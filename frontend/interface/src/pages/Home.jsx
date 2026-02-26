import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSession } from '@/context/SessionContext';
import useIsMobile from '@/hooks/useIsMobile';
import CircuitBoard from '@/components/CircuitBoard';
import DatePicker from '@/components/DatePicker';
import './Home.css';

const BOOT_LINES = [
  '> INITIALIZING CAN BUS INTERFACE...',
  '> CONNECTING TO TELEMETRY FEED...',
  '> LOADING SIGNAL DATABASE...',
  '> SESSION LINK ESTABLISHED',
];

const LINE_STAGGER_MS = 400;
const BOOT_FADE_MS = 2000;
const TITLE_REVEAL_MS = 2300;
const CARDS_REVEAL_MS = 3500;

export default function HomePage() {
  const navigate = useNavigate();
  const { sessionId, setMode, setSelectedDate: setCtxSelectedDate } = useSession();
  const isMobile = useIsMobile();

  // Local date state for the replay date picker
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );

  // Animation phase state
  const [visibleLines, setVisibleLines] = useState([]);
  const [bootFaded, setBootFaded] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [titlePowered, setTitlePowered] = useState(false);
  const [showCards, setShowCards] = useState(false);

  // ---- Boot sequence (desktop only) ----
  useEffect(() => {
    if (isMobile) {
      // Mobile: skip boot, show title immediately with powered state
      setBootFaded(true);
      setTitlePowered(true);
      const t = setTimeout(() => {
        setShowTitle(true);
        setTimeout(() => setShowCards(true), 400);
      }, 200);
      return () => clearTimeout(t);
    }

    // Phase 1: stagger boot lines
    const lineTimers = BOOT_LINES.map((_, i) =>
      setTimeout(() => {
        setVisibleLines((prev) => [...prev, i]);
      }, i * LINE_STAGGER_MS)
    );

    // Phase 2: fade boot text
    const fadeBootTimer = setTimeout(() => {
      setBootFaded(true);
    }, BOOT_FADE_MS);

    // Phase 3: title reveal
    const titleTimer = setTimeout(() => {
      setShowTitle(true);
    }, TITLE_REVEAL_MS);

    // Phase 4: title powered (green -> white)
    const poweredTimer = setTimeout(() => {
      setTitlePowered(true);
    }, TITLE_REVEAL_MS + 800);

    // Phase 5: cards
    const cardsTimer = setTimeout(() => {
      setShowCards(true);
    }, CARDS_REVEAL_MS);

    return () => {
      lineTimers.forEach(clearTimeout);
      clearTimeout(fadeBootTimer);
      clearTimeout(titleTimer);
      clearTimeout(poweredTimer);
      clearTimeout(cardsTimer);
    };
  }, [isMobile]);

  // ---- Handlers ----
  const handleEnterLive = () => {
    setMode('live');
    navigate('/dashboard');
  };

  const handleOpenReplay = () => {
    setMode('replay');
    setCtxSelectedDate(selectedDate);
    navigate('/replay');
  };

  return (
    <>
      {/* Background circuit board */}
      <CircuitBoard
        mobile={isMobile}
        convergeTo={
          showTitle && !titlePowered
            ? { x: window.innerWidth / 2, y: window.innerHeight * 0.45 }
            : null
        }
      />

      <div className="home-wrapper">
        {/* ---- Boot text (desktop only) ---- */}
        {!isMobile && (
          <div
            className="boot-container"
            style={{
              opacity: bootFaded ? 0 : 1,
              pointerEvents: bootFaded ? 'none' : 'auto',
            }}
          >
            {BOOT_LINES.map((line, i) => (
              <div
                key={i}
                className={[
                  'boot-line',
                  visibleLines.includes(i) ? 'visible' : '',
                ].join(' ')}
              >
                {line}
              </div>
            ))}
          </div>
        )}

        {/* ---- Title ---- */}
        {showTitle && (
          <motion.h1
            className="home-title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ color: titlePowered ? '#f0f0f0' : '#4ade80' }}
          >
            NFR DAQ INTERFACE
          </motion.h1>
        )}

        {/* ---- Entry cards ---- */}
        {showCards && (
          <div className="entry-cards">
            {/* Live Telemetry card */}
            <motion.div
              className={`entry-card${sessionId ? ' entry-card--live-active' : ''}`}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0 }}
            >
              <h2 className="entry-card__title">ENTER LIVE TELEMETRY</h2>
              <p className="entry-card__subtitle">
                Stream real-time CAN &amp; sensor data
              </p>
              {sessionId && (
                <span className="session-badge">
                  <span className="session-badge__dot" />
                  SESSION #{sessionId} ACTIVE
                </span>
              )}
              <button
                className="entry-card__btn"
                onClick={handleEnterLive}
              >
                ENTER
              </button>
            </motion.div>

            {/* Replay Session card */}
            <motion.div
              className="entry-card entry-card--replay"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 }}
            >
              <h2 className="entry-card__title">REVIEW SESSION DATA</h2>
              <p className="entry-card__subtitle">
                Analyze past drive sessions
              </p>
              <div style={{ marginBottom: '1.5rem' }}>
                <DatePicker
                  value={selectedDate}
                  onChange={setSelectedDate}
                />
              </div>
              <button
                className="entry-card__btn"
                onClick={handleOpenReplay}
              >
                OPEN
              </button>
            </motion.div>
          </div>
        )}
      </div>
    </>
  );
}
