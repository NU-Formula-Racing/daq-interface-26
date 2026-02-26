import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
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
  const { sessionId, mode, setMode, setSelectedDate: setCtxSelectedDate } = useSession();
  const isLive = mode === "live" && sessionId;
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const cardsContainerVariants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.2 } },
      }
    : {
        hidden: { opacity: 1 },
        visible: {
          opacity: 1,
        },
      };
  const cardVariants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.2 } },
      }
    : {
        hidden: {
          opacity: 0.28,
          clipPath: 'inset(0 100% 0 0 round 8px)',
          filter: 'blur(7px)',
        },
        visible: {
          opacity: 1,
          clipPath: 'inset(0 0% 0 0 round 8px)',
          filter: 'blur(0px)',
          transition: {
            duration: 1.15,
            ease: [0.22, 1, 0.36, 1],
          },
        },
      };

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
    if (isMobile || reduceMotion) {
      // Mobile / reduced motion: skip boot and show content quickly
      setBootFaded(true);
      setTitlePowered(true);
      let cardsTimer;
      const t = setTimeout(() => {
        setShowTitle(true);
        cardsTimer = setTimeout(() => setShowCards(true), 400);
      }, 200);
      return () => {
        clearTimeout(t);
        clearTimeout(cardsTimer);
      };
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
  }, [isMobile, reduceMotion]);

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
        <div className="home-ambient-glow" aria-hidden="true" />
        <div className="home-scanlines" aria-hidden="true" />

        {/* ---- Boot text (desktop only) ---- */}
        {!isMobile && !reduceMotion && (
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
                style={{ '--line-delay': `${i * 0.08}s` }}
              >
                {line}
              </div>
            ))}
            <div className="boot-cursor">_</div>
          </div>
        )}

        {/* ---- Title ---- */}
        {showTitle && (
          <>
            <motion.h1
              className={`home-title${titlePowered ? ' is-powered' : ''}`}
              initial={{ opacity: 0, y: 18, filter: 'blur(6px)', scale: 0.985 }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
              transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
            >
              NFR DAQ INTERFACE
            </motion.h1>
            <motion.p
              className="home-kicker"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 0.8, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
            >
              TELEMETRY CONTROL SURFACE
            </motion.p>
          </>
        )}

        {/* ---- Entry cards ---- */}
        {showCards && (
          <motion.div
            className="entry-cards"
            variants={cardsContainerVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Live Telemetry card */}
            <motion.div
              className={`entry-card${isLive ? ' entry-card--live-active' : ''}`}
              variants={cardVariants}
            >
              <h2 className="entry-card__title">ENTER LIVE TELEMETRY</h2>
              <p className="entry-card__subtitle">
                Stream real-time CAN &amp; sensor data
              </p>
              {isLive && (
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
              variants={cardVariants}
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
          </motion.div>
        )}
      </div>
    </>
  );
}
