import { useNavigate } from 'react-router-dom';
import './AppDownload.css';

// Editorial palette (cream / Northwestern purple)
const E_BG = '#f4f1ec';
const E_INK = '#1a1816';
const E_MUTED = 'rgba(26,24,22,0.6)';
const E_RULE = 'rgba(0,0,0,0.15)';
const E_PURPLE = '#4E2A84';

const SERIF = "'Instrument Serif', serif";
const SANS = "'Inter Tight', Inter, sans-serif";
const MONO_E = "'JetBrains Mono', monospace";

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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: SERIF, fontSize: 26, fontStyle: 'italic', color: E_PURPLE, lineHeight: 1 }}>NFR</span>
        <span style={{ fontFamily: SERIF, fontSize: 26, color: E_INK, lineHeight: 1 }}>interface</span>
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
          borderRadius: 4,
          background: E_PURPLE,
          color: '#fff',
          border: 'none',
          fontFamily: SANS,
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: 0.2,
          boxShadow: '0 6px 20px rgba(78,42,132,0.28)',
          cursor: 'pointer',
          textDecoration: 'none',
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
      <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, color: E_INK, letterSpacing: 0 }}>built in Evanston</span>
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
        <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 84, color: E_PURPLE, lineHeight: 0.85, letterSpacing: -2 }}>
          {n}
        </span>
        <span style={{ fontFamily: MONO_E, fontSize: 10, letterSpacing: 1.5, color: E_MUTED, marginTop: 8 }}>
          {'\u00A7'} {eyebrow}
        </span>
      </div>
      <div>
        <h3 style={{ fontFamily: SERIF, fontSize: 52, fontWeight: 400, letterSpacing: -1, lineHeight: 1.02, margin: '0 0 20px' }}>
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
    <div style={{ background: E_BG, minHeight: '100vh' }}>
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
              fontSize: 156,
              lineHeight: 0.85,
              letterSpacing: -4,
              fontWeight: 400,
              margin: 0,
            }}
          >
            NFR <span style={{ fontStyle: 'italic', color: E_PURPLE }}>Interface</span>
          </h1>
          <p
            className="appdl-cover-sub"
            style={{
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 28,
              lineHeight: 1.3,
              color: E_MUTED,
              maxWidth: 720,
              margin: 0,
              fontWeight: 400,
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
          <p style={{ fontSize: 17, lineHeight: 1.6, color: E_INK, maxWidth: 720, margin: 0 }}>
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
          <p style={{ fontSize: 17, lineHeight: 1.6, color: E_MUTED, maxWidth: 720, margin: '0 0 24px' }}>
            Each panel reads a named signal. Add graphs, gauges, numerics, bars, heatmaps {'\u2014'} drag to resize, click the {'\u00D7'} to remove. Layouts persist between sessions.
          </p>
          <div
            style={{
              width: '100%',
              maxWidth: 1080,
              aspectRatio: '1080 / 560',
              background: '#1a1816',
              borderRadius: 8,
              border: `1px solid ${E_RULE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)',
              fontFamily: MONO_E,
              fontSize: 11,
              letterSpacing: 1.5,
            }}
          >
            [DASHBOARD PREVIEW]
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
                <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 28, color: E_PURPLE, lineHeight: 1 }}>
                  {c.roman}
                </span>
                <span style={{ fontFamily: SERIF, fontSize: 32, letterSpacing: -0.5, lineHeight: 1.05 }}>{c.t}</span>
                <span style={{ fontSize: 14, lineHeight: 1.55, color: E_MUTED }}>{c.b}</span>
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
              fontSize: 52,
              fontStyle: 'italic',
              lineHeight: 1.1,
              letterSpacing: -1,
              color: E_INK,
              maxWidth: 900,
              margin: 0,
              fontWeight: 400,
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
