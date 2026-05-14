import { useNavigate } from 'react-router-dom';
import FRWindow from '../components/FRWindow.jsx';
import './AppDownload.css';

// Design tokens — desktop palette
const E_BG = 'var(--c-bg)';
const E_INK = 'var(--c-text)';
const E_MUTED = 'var(--c-text-mute)';
const E_RULE = 'var(--c-border)';
const E_PURPLE = 'var(--c-accent-bright)';

const SERIF = "var(--font-mono)";
const SANS = "var(--font-mono)";
const MONO_E = "var(--font-mono)";

const RELEASES_URL = 'https://github.com/NU-Formula-Racing/daq-interface-26/releases/latest';

function ENav({ issue = 'A FIELD GUIDE', onBack }) {
  const linkBase = {
    fontFamily: MONO_E,
    fontSize: 11,
    letterSpacing: 1.2,
    color: E_MUTED,
  };
  return (
    <div
      className="appdl-nav"
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '20px 56px',
        borderBottom: `1px solid ${E_RULE}`,
        gap: 28,
      }}
    >
      <div
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: 'pointer' }}
      >
        <span style={{ fontFamily: SERIF, fontSize: 14, letterSpacing: '0.1em', color: E_PURPLE, lineHeight: 1, textTransform: 'uppercase', fontWeight: 700 }}>NFR</span>
        <span style={{ fontFamily: SERIF, fontSize: 14, letterSpacing: '0.1em', color: E_INK, lineHeight: 1, textTransform: 'uppercase', fontWeight: 700 }}>interface</span>
      </div>
      <span style={{ fontFamily: MONO_E, fontSize: 10, color: E_MUTED, letterSpacing: 1.5, marginLeft: 4 }}>{issue}</span>
      <div style={{ flex: 1 }} />
      <div className="appdl-nav-links" style={{ display: 'flex', gap: 28 }}>
        <span style={linkBase}>FEATURES</span>
        <span style={linkBase}>TELEMETRY</span>
        <span style={linkBase}>DOCS</span>
        <span
          onClick={onBack}
          style={{ ...linkBase, cursor: 'pointer' }}
        >
          {'\u2190'} BACK
        </span>
      </div>
    </div>
  );
}

function EDownload() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '15px 24px',
          borderRadius: 0,
          background: 'var(--c-accent)',
          color: 'var(--c-text)',
          border: '1px solid var(--c-accent-bright)',
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '1.2px',
          boxShadow: 'none',
          cursor: 'pointer',
          textDecoration: 'none',
          textTransform: 'uppercase',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 1v9M4 6l4 4 4-4M2 12v2h12v-2" />
        </svg>
        Download NFR Interface
      </a>
      <span
        style={{
          fontFamily: MONO_E,
          fontSize: 11,
          color: E_MUTED,
          letterSpacing: 0.8,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <span title="macOS">{'\u2318'}</span>
          <span style={{ opacity: 0.4 }}>{'\u00B7'}</span>
          <span title="Linux">{'\u25B3'}</span>
          <span style={{ opacity: 0.4 }}>{'\u00B7'}</span>
          <span title="Windows">{'\u229E'}</span>
        </span>
        <span>macOS {'\u00B7'} Linux {'\u00B7'} Windows</span>
      </span>
    </div>
  );
}

function EFooter() {
  return (
    <div
      className="appdl-footer"
      style={{
        padding: '32px 56px',
        borderTop: `1px solid ${E_RULE}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: MONO_E,
        fontSize: 10,
        color: E_MUTED,
        letterSpacing: 1,
      }}
    >
      <span>{'\u00A9'} NORTHWESTERN FORMULA RACING</span>
      <span style={{ fontFamily: SERIF, fontSize: 11, color: E_MUTED, letterSpacing: '1px', textTransform: 'uppercase' }}>built in Evanston</span>
      <span>nfrinterface.com</span>
    </div>
  );
}

function Chapter({ n, title, eyebrow, children }) {
  return (
    <div
      className="appdl-chapter"
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: 32,
        padding: '52px 56px',
        borderTop: `1px solid ${E_RULE}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontFamily: MONO_E, fontSize: 10, letterSpacing: 1.5, color: E_MUTED }}>CHAPTER</span>
        <span style={{ fontFamily: SERIF, fontSize: 64, color: E_PURPLE, lineHeight: 0.85, letterSpacing: '-1px', fontWeight: 700 }}>
          {n}
        </span>
        <span style={{ fontFamily: MONO_E, fontSize: 10, letterSpacing: 1.5, color: E_MUTED, marginTop: 8 }}>
          {'\u00A7'} {eyebrow}
        </span>
      </div>
      <div>
        <h3 style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 600, letterSpacing: '1px', lineHeight: 1.15, margin: '0 0 20px', color: 'var(--c-text)', textTransform: 'uppercase' }}>
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export default function AppDownload() {
  const navigate = useNavigate();

  const modes = [
    {
      roman: 'i.',
      t: 'Live',
      b: 'Plug the car in over USB-serial. Frames decode at 500 Hz, every channel \u2014 exactly what the driver sees.',
    },
    {
      roman: 'ii.',
      t: 'Replay',
      b: 'Drop a .nfr log file. Embedded Postgres holds every session locally. Scrub, compare, query.',
    },
    {
      roman: 'iii.',
      t: 'Broadcast',
      b: 'One toggle starts a local web server. Anyone on pit Wi-Fi opens the dash in a browser, no install.',
    },
  ];

  return (
    <div className="marketing" style={{ background: E_BG, minHeight: '100vh' }}>
      <div
        className="appdl-page"
        style={{
          maxWidth: 1280,
          width: '100%',
          margin: '0 auto',
          background: E_BG,
          color: E_INK,
          fontFamily: SANS,
        }}
      >
        <ENav issue="A FIELD GUIDE" onBack={() => navigate('/')} />

        {/* Cover */}
        <div
          className="appdl-cover"
          style={{
            padding: '120px 56px 90px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 30,
            borderBottom: `1px solid ${E_RULE}`,
          }}
        >
          <div style={{ fontFamily: MONO_E, fontSize: 11, letterSpacing: 2.5, color: E_PURPLE }}>
            {'\u00B7 \u00B7 \u00B7'} A FIELD GUIDE TO {'\u00B7 \u00B7 \u00B7'}
          </div>
          <h1
            className="appdl-h1"
            style={{
              fontFamily: SERIF,
              fontSize: 'clamp(48px, 10vw, 96px)',
              lineHeight: 1.05,
              letterSpacing: '0.08em',
              fontWeight: 700,
              margin: 0,
              textTransform: 'uppercase',
              color: 'var(--c-text)',
            }}
          >
            NFR <span style={{ color: E_PURPLE }}>Interface</span>
          </h1>
          <p
            className="appdl-cover-sub"
            style={{
              fontFamily: SERIF,
              fontSize: 13,
              lineHeight: 1.6,
              color: E_MUTED,
              maxWidth: 720,
              margin: 0,
              fontWeight: 400,
              letterSpacing: '0.06em',
            }}
          >
            A short manual for reading the NFR 26 car {'\u2014'} live from the bus, replayed from a log, broadcast to the pit.
          </p>
          <div style={{ marginTop: 24 }}>
            <EDownload />
          </div>
        </div>

        {/* Chapter 01 */}
        <Chapter
          n="01"
          eyebrow="THE TOOL"
          title={
            <>
              It is a <span style={{ fontStyle: 'italic', color: E_PURPLE }}>desktop app</span>, on every platform.
            </>
          }
        >
          <p style={{ fontSize: 12, lineHeight: 1.7, color: E_MUTED, maxWidth: 720, margin: 0, fontFamily: MONO_E }}>
            Built for the embedded subteam at Northwestern Formula Racing. One window holds every signal from the car {'\u2014'} engine, inverter, brakes, tires, IMU {'\u2014'} decoded against the team's DBC and rendered into a tiled dashboard you can rearrange to taste.
          </p>
        </Chapter>

        {/* Chapter 02 */}
        <Chapter
          n="02"
          eyebrow="THE INTERFACE"
          title={
            <>
              Tile, decode, <span style={{ fontStyle: 'italic', color: E_PURPLE }}>watch.</span>
            </>
          }
        >
          <p style={{ fontSize: 12, lineHeight: 1.7, color: E_MUTED, maxWidth: 720, margin: '0 0 24px', fontFamily: MONO_E }}>
            Each panel reads a named signal. Add graphs, gauges, numerics, bars, heatmaps {'\u2014'} drag to resize, click the {'\u00D7'} to remove. Layouts persist between sessions.
          </p>
          <div className="appdl-frwindow-wrap" style={{ width: '100%', maxWidth: 1080 }}>
            <FRWindow />
          </div>
        </Chapter>

        {/* Chapter 03 */}
        <Chapter
          n="03"
          eyebrow="THREE MODES"
          title={
            <>
              Live, replay, <span style={{ fontStyle: 'italic', color: E_PURPLE }}>broadcast.</span>
            </>
          }
        >
          <div
            className="appdl-modes"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 28,
              marginTop: 8,
            }}
          >
            {modes.map((c) => (
              <div
                key={c.t}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  paddingTop: 20,
                  borderTop: `1px solid ${E_RULE}`,
                }}
              >
                <span style={{ fontFamily: SERIF, fontSize: 11, letterSpacing: '0.15em', color: E_PURPLE, lineHeight: 1 }}>
                  {c.roman}
                </span>
                <span style={{ fontFamily: SERIF, fontSize: 14, letterSpacing: '0.1em', lineHeight: 1.2, fontWeight: 600, textTransform: 'uppercase', color: 'var(--c-text)' }}>{c.t}</span>
                <span style={{ fontSize: 11, lineHeight: 1.65, color: E_MUTED, fontFamily: SERIF }}>{c.b}</span>
              </div>
            ))}
          </div>
        </Chapter>

        {/* Closing */}
        <div
          className="appdl-closing"
          style={{
            padding: '90px 56px',
            borderTop: `1px solid ${E_RULE}`,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 28,
          }}
        >
          <p
            className="appdl-closing-quote"
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              lineHeight: 1.4,
              letterSpacing: '0.06em',
              color: E_MUTED,
              maxWidth: 900,
              margin: 0,
              fontWeight: 400,
              textTransform: 'uppercase',
            }}
          >
            Built by the people who drive the car.
          </p>
          <EDownload />
        </div>

        <EFooter />
      </div>
    </div>
  );
}
