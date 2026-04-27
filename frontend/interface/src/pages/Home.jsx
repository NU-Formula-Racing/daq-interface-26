import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import { useSession } from '@/context/SessionContext';
import useIsMobile from '@/hooks/useIsMobile';
import CircuitBoard from '@/components/CircuitBoard';
import './Home.css';

const ACCENT = '#a78bfa';

const hexToRgba = (hex, a = 1) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// ---------- Atoms ----------

const StatusDot = ({ color = ACCENT, online = true, size = 7 }) => (
  <span
    style={{
      position: 'relative',
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: 999,
      background: online ? color : '#475569',
      boxShadow: online ? `0 0 12px ${color}, 0 0 4px ${color}` : 'none',
    }}
  >
    {online && (
      <span
        className="nfr-pulse-ring"
        style={{
          position: 'absolute',
          inset: -3,
          borderRadius: 999,
          border: `1px solid ${color}`,
        }}
      />
    )}
  </span>
);

const TerminalCard = ({
  label,
  index,
  status,
  statusOnline = true,
  accent = ACCENT,
  children,
  active = false,
  onMouseEnter,
  onMouseLeave,
  notch = 18,
}) => {
  const clip = `polygon(0 0, calc(100% - ${notch}px) 0, 100% ${notch}px, 100% 100%, ${notch}px 100%, 0 calc(100% - ${notch}px))`;
  const innerClip = `polygon(0 0, calc(100% - ${notch - 1}px) 0, 100% ${notch - 1}px, 100% 100%, ${notch - 1}px 100%, 0 calc(100% - ${notch - 1}px))`;
  const borderColor = active ? hexToRgba(accent, 0.5) : 'rgba(120, 140, 160, 0.22)';

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'relative',
        transition: 'transform 200ms ease, filter 200ms ease',
        transform: active ? 'translateY(-1px)' : 'translateY(0)',
        filter: active
          ? `drop-shadow(0 18px 40px ${hexToRgba(accent, 0.22)})`
          : 'drop-shadow(0 18px 40px rgba(0,0,0,0.5))',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: borderColor,
          clipPath: clip,
          WebkitClipPath: clip,
          transition: 'background 200ms ease',
        }}
      />
      <div
        style={{
          position: 'relative',
          margin: 1,
          background: 'rgba(8, 12, 18, 0.82)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          clipPath: innerClip,
          WebkitClipPath: innerClip,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `10px ${notch + 4}px 10px 16px`,
            borderBottom: '1px solid rgba(120, 140, 160, 0.14)',
            fontFamily: 'var(--mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(180, 200, 220, 0.55)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 6,
                height: 6,
                background: accent,
                boxShadow: `0 0 8px ${accent}`,
                borderRadius: 1,
              }}
            />
            <span>{label}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'rgba(180, 200, 220, 0.35)' }}>{index}</span>
            {status && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusDot color={statusOnline ? accent : '#64748b'} online={statusOnline} />
                <span style={{ color: statusOnline ? accent : 'rgba(180,200,220,0.5)' }}>{status}</span>
              </span>
            )}
          </span>
        </div>

        <div style={{ padding: `24px 24px ${notch + 8}px` }}>{children}</div>
      </div>

      {/* chamfer hairlines — CSS-rotated divs because SVG line attributes don't support calc() */}
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: `calc(100% - ${notch}px)`,
          width: notch * 1.4142,
          height: 1,
          background: active ? accent : 'rgba(180,200,220,0.45)',
          transformOrigin: '0 0',
          transform: 'rotate(45deg)',
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: `calc(100% - ${notch}px)`,
          left: 0,
          width: notch * 1.4142,
          height: 1,
          background: active ? accent : 'rgba(180,200,220,0.45)',
          transformOrigin: '0 0',
          transform: 'rotate(45deg)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

const HudButton = ({ children, accent = ACCENT, onClick, full = true, size = 'lg' }) => {
  const [hover, setHover] = useState(false);
  const sizes = {
    lg: { py: 14, fs: 12, lt: '0.32em', notch: 10 },
    md: { py: 10, fs: 11, lt: '0.28em', notch: 8 },
  };
  const s = sizes[size] || sizes.lg;
  const n = s.notch;
  const clip = `polygon(0 0, calc(100% - ${n}px) 0, 100% ${n}px, 100% 100%, ${n}px 100%, 0 calc(100% - ${n}px))`;
  const innerClip = `polygon(0 0, calc(100% - ${n - 1}px) 0, 100% ${n - 1}px, 100% 100%, ${n - 1}px 100%, 0 calc(100% - ${n - 1}px))`;
  const borderColor = hover ? hexToRgba(accent, 0.6) : 'rgba(120, 140, 160, 0.32)';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: full ? '100%' : 'auto',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        color: hover ? accent : 'rgba(220, 230, 240, 0.92)',
        transition: 'color 160ms ease',
        filter: hover ? `drop-shadow(0 0 14px ${hexToRgba(accent, 0.35)})` : 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: 0,
          background: borderColor,
          clipPath: clip,
          WebkitClipPath: clip,
          transition: 'background 160ms ease',
        }}
      />
      <span
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 1,
          padding: `${s.py}px 20px`,
          background: hover ? hexToRgba(accent, 0.08) : 'rgba(20, 28, 38, 0.5)',
          fontFamily: 'var(--mono)',
          fontSize: s.fs,
          letterSpacing: s.lt,
          textTransform: 'uppercase',
          clipPath: innerClip,
          WebkitClipPath: innerClip,
          transition: 'background 160ms ease',
        }}
      >
        {children}
        <span style={{ opacity: hover ? 1 : 0.5, transition: 'opacity 160ms', fontSize: 10, marginLeft: 10 }}>›</span>
      </span>
    </button>
  );
};

const DateField = ({ value, onChange, accent = ACCENT, options }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(8, 12, 18, 0.85)',
          border: `1px solid ${open ? hexToRgba(accent, 0.45) : 'rgba(120,140,160,0.22)'}`,
          padding: '10px 12px',
          fontFamily: 'var(--mono)',
          fontSize: 12,
          color: 'rgba(220, 230, 240, 0.92)',
          letterSpacing: '0.04em',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: accent, fontSize: 9, letterSpacing: '0.2em' }}>DATE</span>
          <span>{value}</span>
        </span>
        <span style={{ color: 'rgba(180,200,220,0.55)', fontSize: 9 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'rgba(10, 14, 20, 0.98)',
            border: `1px solid ${hexToRgba(accent, 0.3)}`,
            zIndex: 5,
            maxHeight: 220,
            overflow: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 12,
            boxShadow: `0 12px 30px -10px ${hexToRgba(accent, 0.25)}`,
          }}
        >
          {options.map((opt) => (
            <button
              key={opt.date}
              onClick={() => {
                onChange(opt.date);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                background: opt.date === value ? hexToRgba(accent, 0.08) : 'transparent',
                color: opt.date === value ? accent : 'rgba(220,230,240,0.85)',
                border: 'none',
                borderBottom: '1px solid rgba(120,140,160,0.08)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(accent, 0.06))}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = opt.date === value ? hexToRgba(accent, 0.08) : 'transparent')
              }
            >
              <span>{opt.date}</span>
              <span style={{ color: 'rgba(180,200,220,0.45)', fontSize: 10 }}>{opt.meta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------- Header ----------

const Header = ({ accent }) => (
  <div style={{ textAlign: 'center', marginBottom: 56, width: '100%' }}>
    <div
      className="home-tagline"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.4em',
        textTransform: 'uppercase',
        color: 'rgba(180, 200, 220, 0.45)',
        marginBottom: 22,
      }}
    >
      <span style={{ width: 28, height: 1, background: 'rgba(180,200,220,0.25)' }} />
      <span style={{ color: accent }}>NFR · DAQ</span>
      <span>v2.4.1</span>
      <span style={{ width: 28, height: 1, background: 'rgba(180,200,220,0.25)' }} />
    </div>

    <h1
      className="home-h1"
      style={{
        fontFamily: 'var(--mono)',
        fontWeight: 500,
        fontSize: 'clamp(34px, 5.6vw, 72px)',
        letterSpacing: '0.04em',
        color: '#f1f5f9',
        margin: 0,
        lineHeight: 1.0,
        textShadow: `0 0 40px ${hexToRgba(accent, 0.12)}`,
        wordBreak: 'break-word',
      }}
    >
      NFR DAQ INTERFACE
    </h1>

    <div
      className="home-kicker"
      style={{
        marginTop: 14,
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.42em',
        textTransform: 'uppercase',
        color: 'rgba(180, 200, 220, 0.55)',
      }}
    >
      Telemetry Control Surface
    </div>
  </div>
);

// ---------- Local app row ----------

const LocalAppRow = ({ accent, onClick }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        marginTop: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        flexWrap: 'wrap',
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(180, 200, 220, 0.55)',
      }}
    >
      <span style={{ width: 40, height: 1, background: 'rgba(120,140,160,0.18)' }} />
      <span>Need the bridge?</span>
      <a
        href="/app"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: 0,
          color: hover ? accent : 'rgba(220, 230, 240, 0.85)',
          textDecoration: 'none',
          letterSpacing: '0.22em',
          fontSize: 10.5,
          transition: 'color 150ms ease',
          filter: hover ? `drop-shadow(0 0 10px ${hexToRgba(accent, 0.4)})` : 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: hover ? hexToRgba(accent, 0.55) : 'rgba(120,140,160,0.32)',
            clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
            WebkitClipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))',
            transition: 'background 150ms ease',
          }}
        />
        <span
          style={{
            position: 'relative',
            margin: 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            background: hover ? hexToRgba(accent, 0.08) : 'rgba(20,28,38,0.5)',
            clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px))',
            WebkitClipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 7px 100%, 0 calc(100% - 7px))',
          }}
        >
          <span style={{ width: 6, height: 6, background: accent, borderRadius: 999, boxShadow: `0 0 8px ${accent}` }} />
          Install Local App
          <span style={{ opacity: 0.6 }}>↗</span>
        </span>
      </a>
      <span style={{ width: 40, height: 1, background: 'rgba(120,140,160,0.18)' }} />
    </div>
  );
};

// ---------- Page ----------

export default function HomePage() {
  const navigate = useNavigate();
  const { setMode, setSelectedDate: setCtxSelectedDate } = useSession();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  const sessions = useMemo(
    () => [
      { date: '2026-04-27', meta: 'PRACTICE' },
      { date: '2026-04-19', meta: 'QUALI' },
      { date: '2026-04-11', meta: 'TEST' },
      { date: '2026-03-28', meta: 'RACE' },
      { date: '2026-03-14', meta: 'TEST' },
      { date: '2026-02-24', meta: 'PRACTICE' },
    ],
    []
  );

  const [date, setDate] = useState(sessions[0].date);
  const [liveHover, setLiveHover] = useState(false);
  const [replayHover, setReplayHover] = useState(false);

  const online = true;
  const accent = ACCENT;

  const handleEnterLive = () => {
    setMode('live');
    navigate('/dashboard');
  };

  const handleOpenReplay = () => {
    setMode('replay');
    setCtxSelectedDate(date);
    navigate('/graphs');
  };

  // suppress unused warning when reduced motion is on; kept for parity
  void reduceMotion;

  return (
    <div className="home-wrapper">
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 50%, #0a0e16 0%, #050709 80%)',
        }}
      >
        <CircuitBoard mobile={isMobile} />
      </div>

      <div className="home-vignette" aria-hidden="true" />
      <div className="home-scanlines" aria-hidden="true" />

      <div className="home-content">
        <Header accent={accent} />

        <div className="home-cards-grid">
          <TerminalCard
            label="01 · Live"
            index="//STREAM"
            status={online ? 'CONNECTED' : 'OFFLINE'}
            statusOnline={online}
            accent={accent}
            active={liveHover}
            onMouseEnter={() => setLiveHover(true)}
            onMouseLeave={() => setLiveHover(false)}
          >
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 13,
                color: 'rgba(220, 230, 240, 0.85)',
                lineHeight: 1.5,
                marginBottom: 28,
              }}
            >
              Stream real-time CAN &amp; sensor data
            </div>
            <HudButton accent={accent} onClick={handleEnterLive}>Enter</HudButton>
          </TerminalCard>

          <TerminalCard
            label="02 · Replay"
            index="//ARCHIVE"
            accent={accent}
            active={replayHover}
            onMouseEnter={() => setReplayHover(true)}
            onMouseLeave={() => setReplayHover(false)}
          >
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 13,
                color: 'rgba(220, 230, 240, 0.85)',
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              Analyze past drive sessions
            </div>

            <div style={{ marginBottom: 14 }}>
              <DateField value={date} onChange={setDate} accent={accent} options={sessions} />
            </div>

            <HudButton accent={accent} onClick={handleOpenReplay}>Open</HudButton>
          </TerminalCard>
        </div>

        <LocalAppRow accent={accent} onClick={() => navigate('/app')} />
      </div>
    </div>
  );
}
