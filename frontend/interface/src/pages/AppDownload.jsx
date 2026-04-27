import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useIsMobile from '@/hooks/useIsMobile';
import CircuitBoard from '@/components/CircuitBoard';
import './AppDownload.css';

const ACCENT = '#a78bfa';

const hexToRgba = (hex, a = 1) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const TerminalCard = ({ label, index, accent = ACCENT, children, notch = 18 }) => {
  const clip = `polygon(0 0, calc(100% - ${notch}px) 0, 100% ${notch}px, 100% 100%, ${notch}px 100%, 0 calc(100% - ${notch}px))`;
  const innerClip = `polygon(0 0, calc(100% - ${notch - 1}px) 0, 100% ${notch - 1}px, 100% 100%, ${notch - 1}px 100%, 0 calc(100% - ${notch - 1}px))`;

  return (
    <div
      style={{
        position: 'relative',
        filter: 'drop-shadow(0 18px 40px rgba(0,0,0,0.5))',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(120, 140, 160, 0.22)',
          clipPath: clip,
          WebkitClipPath: clip,
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
          <span style={{ color: 'rgba(180, 200, 220, 0.35)' }}>{index}</span>
        </div>

        <div style={{ padding: `28px 28px ${notch + 12}px` }}>{children}</div>
      </div>

      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        preserveAspectRatio="none"
      >
        <line
          x1={`calc(100% - ${notch}px)`}
          y1="0"
          x2="100%"
          y2={notch}
          stroke="rgba(180,200,220,0.45)"
          strokeWidth="1"
        />
        <line
          x1="0"
          y1={`calc(100% - ${notch}px)`}
          x2={notch}
          y2="100%"
          stroke="rgba(180,200,220,0.45)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
};

const HudButton = ({ children, accent = ACCENT, onClick }) => {
  const [hover, setHover] = useState(false);
  const n = 10;
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
        width: '100%',
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
          padding: '16px 20px',
          background: hover ? hexToRgba(accent, 0.08) : 'rgba(20, 28, 38, 0.5)',
          fontFamily: 'var(--mono)',
          fontSize: 12,
          letterSpacing: '0.32em',
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

export default function AppDownload() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const accent = ACCENT;

  const Bullet = ({ children }) => (
    <li
      style={{
        position: 'relative',
        paddingLeft: 20,
        marginBottom: 10,
        fontFamily: 'var(--mono)',
        fontSize: 13,
        color: 'rgba(220, 230, 240, 0.85)',
        lineHeight: 1.55,
        listStyle: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: 8,
          width: 6,
          height: 6,
          background: accent,
          boxShadow: `0 0 8px ${accent}`,
          borderRadius: 1,
        }}
      />
      {children}
    </li>
  );

  return (
    <div className="appdl-wrapper">
      <CircuitBoard mobile={isMobile} />

      <div className="appdl-vignette" aria-hidden="true" />
      <div className="appdl-scanlines" aria-hidden="true" />

      <div className="appdl-content">
        <button
          onClick={() => navigate('/')}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 'none',
            color: 'rgba(180, 200, 220, 0.65)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: '8px 0',
            marginBottom: 28,
          }}
        >
          {'\u2190'} Back
        </button>

        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: '0.4em',
              textTransform: 'uppercase',
              color: 'rgba(180, 200, 220, 0.45)',
              marginBottom: 18,
            }}
          >
            <span style={{ width: 28, height: 1, background: 'rgba(180,200,220,0.25)' }} />
            <span style={{ color: accent }}>NFR · LOCAL</span>
            <span>v0.1</span>
            <span style={{ width: 28, height: 1, background: 'rgba(180,200,220,0.25)' }} />
          </div>
          <h1
            style={{
              fontFamily: 'var(--mono)',
              fontWeight: 500,
              fontSize: 'clamp(28px, 4.4vw, 52px)',
              letterSpacing: '0.04em',
              color: '#f1f5f9',
              margin: 0,
              lineHeight: 1.1,
              textShadow: `0 0 40px ${hexToRgba(accent, 0.12)}`,
            }}
          >
            NFR LOCAL · DESKTOP APP
          </h1>
        </div>

        <div style={{ width: '100%', maxWidth: 720 }}>
          <TerminalCard label="// PACKAGE" index="DESKTOP" accent={accent}>
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 13,
                color: 'rgba(220, 230, 240, 0.85)',
                lineHeight: 1.6,
                margin: '0 0 22px 0',
              }}
            >
              An offline copy of the NFR DAQ interface that bundles a local Postgres database. Use it on the team laptop to record live telemetry and review sessions without an internet connection.
            </p>

            <ul style={{ padding: 0, margin: '0 0 26px 0' }}>
              <Bullet>Decode CAN over USB serial.</Bullet>
              <Bullet>Ingest .nfr files from SD card.</Bullet>
              <Bullet>Broadcast the dashboard on LAN.</Bullet>
            </ul>

            <HudButton accent={accent} onClick={() => alert('Build coming soon')}>
              Download for macOS (arm64)
            </HudButton>

            <div
              style={{
                marginTop: 14,
                fontFamily: 'var(--mono)',
                fontSize: 10.5,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'rgba(180, 200, 220, 0.5)',
                textAlign: 'center',
              }}
            >
              Linux and Windows builds coming later.
            </div>
          </TerminalCard>
        </div>
      </div>
    </div>
  );
}
