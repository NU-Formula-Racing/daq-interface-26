import { useEffect, useMemo, useRef, useState } from 'react';

const COLORS = {
  bg: '#1e1f22',
  bgInner: '#2b2d30',
  border: 'rgba(255,255,255,0.09)',
  text: '#dfe1e5',
  textMute: '#9da0a8',
  textFaint: '#6b6e76',
  accentBright: '#a78bfa',
  liveGreen: '#4ade80',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW_LABELS = ['S','M','T','W','T','F','S'];

function smallBtn() {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${COLORS.border}`,
    color: COLORS.textMute, fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}

function LiveSection({ sessions, currentId, onPick }) {
  if (!sessions || sessions.length === 0) return null;
  return (
    <div style={{
      borderBottom: `1px solid ${COLORS.border}`,
      fontFamily: '"JetBrains Mono", monospace',
    }}>
      <div style={{
        padding: '8px 12px 6px', fontSize: 9, letterSpacing: 1,
        color: COLORS.liveGreen,
      }}>
        ● LIVE (last 12h)
      </div>
      {sessions.map((s) => {
        const active = s.id === currentId;
        const t = new Date(s.started_at).toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
        const status = s.ended_at ? 'ENDED' : 'LIVE';
        return (
          <div
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              padding: '8px 12px', cursor: 'pointer',
              background: active ? 'rgba(74,222,128,0.12)' : 'transparent',
              fontSize: 10, color: COLORS.text,
              display: 'flex', justifyContent: 'space-between', gap: 8,
            }}
          >
            <span>{status} · {t}{s.machine ? ` · ${s.machine}` : ''}</span>
            <span style={{ color: COLORS.textFaint, fontSize: 9 }}>
              {s.id.slice(0, 8)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CalendarPanel({ cursor, cells, onPrev, onNext, onToday, onPickDate, emptyHint }) {
  const today = new Date();
  const todayIso =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return (
    <div style={{ padding: 12, fontFamily: '"JetBrains Mono", monospace' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10 }}>
        <button onClick={onPrev} style={{ ...smallBtn(), padding:'2px 8px' }}>‹</button>
        <span style={{ fontSize: 11, color: COLORS.text, letterSpacing: 1, fontWeight: 600 }}>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <div style={{ display:'flex', gap: 4 }}>
          <button onClick={onToday} style={{ ...smallBtn(), padding:'2px 6px', fontSize: 9 }}>TODAY</button>
          <button onClick={onNext} style={{ ...smallBtn(), padding:'2px 8px' }}>›</button>
        </div>
      </div>
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 2,
        marginBottom: 4, fontSize: 9, color: COLORS.textFaint,
      }}>
        {DOW_LABELS.map((d, i) => (
          <span key={i} style={{ textAlign:'center', padding:'2px 0' }}>{d}</span>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((c) => {
          const has = c.sessions > 0;
          const isToday = c.iso === todayIso;
          const dim = !c.inMonth;
          return (
            <button
              key={c.iso}
              onClick={() => has && onPickDate(c.iso)}
              disabled={!has}
              style={{
                aspectRatio:'1 / 1', padding: 0,
                background: has ? 'rgba(167,139,250,0.22)' : 'transparent',
                border: isToday
                  ? `1px solid ${COLORS.accentBright}`
                  : `1px solid ${has ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.05)'}`,
                color: has ? COLORS.text : dim ? COLORS.textFaint : COLORS.textMute,
                cursor: has ? 'pointer' : 'default',
                fontFamily:'"JetBrains Mono", monospace', fontSize: 10,
                display:'flex', alignItems:'center', justifyContent:'center',
                position:'relative', opacity: dim ? 0.4 : 1,
              }}
              title={has ? `${c.sessions} session${c.sessions === 1 ? '' : 's'}` : ''}
            >
              {c.date.getDate()}
              {has && c.sessions > 1 && (
                <span data-testid="session-count-badge" style={{
                  position:'absolute', bottom: 2, right: 4,
                  fontSize: 8, color: COLORS.accentBright,
                }}>
                  {c.sessions}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {emptyHint && (
        <div style={{ marginTop: 10, fontSize: 9, color: COLORS.textFaint, textAlign:'center' }}>
          {emptyHint}
        </div>
      )}
    </div>
  );
}

function SessionDayList({ date, sessions, currentId, onPick, onBack }) {
  return (
    <div style={{ fontFamily:'"JetBrains Mono", monospace' }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 12px', borderBottom:`1px solid ${COLORS.border}`,
      }}>
        <button onClick={onBack} style={{ ...smallBtn(), padding:'2px 8px', fontSize: 9 }}>← BACK</button>
        <span style={{ fontSize: 10, color: COLORS.textMute, letterSpacing: 1 }}>
          {date} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </span>
      </div>
      {sessions.map((s) => {
        const active = s.id === currentId;
        return (
          <div
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              padding:'10px 12px', borderBottom:`1px solid ${COLORS.border}`,
              cursor:'pointer',
              background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
              fontSize: 10, color: COLORS.text,
            }}
          >
            <div style={{ display:'flex', justifyContent:'space-between', gap: 8 }}>
              <span>{new Date(s.started_at).toLocaleTimeString()}</span>
              <span style={{ color: COLORS.textFaint, fontSize: 9 }}>
                {s.id.slice(0, 8)}
              </span>
            </div>
            {(s.driver || s.car) && (
              <div style={{
                marginTop: 2, color: COLORS.textMute, fontSize: 9, display:'flex', gap: 8,
              }}>
                {s.driver && <span>{s.driver}</span>}
                {s.car && <span>· {s.car}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Calendar-style session picker. Mirrors the desktop app's SessionPicker UX.
 *
 * Props:
 *   sessions: SessionListItem[]   full list (filtered internally to source==='sd_import')
 *   liveSessions: LiveSessionRow[] (optional) — shown above the calendar
 *   currentId: string | null
 *   onPick(id: string)
 */
export default function SessionPicker({ sessions, currentId, onPick, liveSessions = [] }) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const autoJumpedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSelectedDate(null);
      autoJumpedRef.current = false;
    }
  }, [open]);

  const sdSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.source === 'sd_import'),
    [sessions],
  );

  useEffect(() => {
    if (!open || autoJumpedRef.current) return;
    if (sdSessions.length === 0) { autoJumpedRef.current = true; return; }
    const latest = sdSessions.reduce((acc, s) => (s.date > acc ? s.date : acc), sdSessions[0].date);
    const [y, m] = latest.split('-').map((x) => parseInt(x, 10));
    if (y && m) setCursor(new Date(y, m - 1, 1));
    autoJumpedRef.current = true;
  }, [open, sdSessions]);

  const dayMap = useMemo(() => {
    const m = new Map();
    for (const s of sdSessions) {
      const arr = m.get(s.date);
      if (arr) arr.push(s);
      else m.set(s.date, [s]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
    }
    return m;
  }, [sdSessions]);

  const current =
    sessions?.find((s) => s.id === currentId) ??
    liveSessions?.find((s) => s.id === currentId);
  const isLiveCurrent = currentId && liveSessions?.some((s) => s.id === currentId);
  const label = currentId
    ? current
      ? isLiveCurrent
        ? `● LIVE · ${current.id.slice(0, 8)}`
        : `${new Date(current.started_at).toLocaleDateString()} · ${currentId.slice(0, 8)}`
      : currentId.slice(0, 8)
    : 'Select session';

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startSunday = new Date(firstOfMonth);
    startSunday.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      out.push({
        date: d, iso,
        inMonth: d.getMonth() === cursor.getMonth(),
        sessions: dayMap.get(iso)?.length ?? 0,
      });
    }
    return out;
  }, [cursor, dayMap]);

  const dropdownStyle = {
    position:'absolute', top:'calc(100% + 4px)', right: 0,
    width: 380, maxHeight: 460, overflow:'auto',
    background: COLORS.bg, border:`1px solid ${COLORS.border}`,
    zIndex: 51, boxShadow:'0 8px 24px rgba(0,0,0,0.55)',
  };

  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...smallBtn(), color: COLORS.text, padding:'4px 10px' }}>
        {label} ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset: 0, zIndex: 50 }} />
          <div style={dropdownStyle}>
            {selectedDate ? (
              <SessionDayList
                date={selectedDate}
                sessions={dayMap.get(selectedDate) ?? []}
                currentId={currentId}
                onPick={(id) => { onPick(id); setOpen(false); }}
                onBack={() => setSelectedDate(null)}
              />
            ) : (
              <>
                <LiveSection
                  sessions={liveSessions}
                  currentId={currentId}
                  onPick={(id) => { onPick(id); setOpen(false); }}
                />
                <CalendarPanel
                  cursor={cursor}
                  cells={cells}
                  onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                  onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                  onToday={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}
                  onPickDate={(iso) => setSelectedDate(iso)}
                  emptyHint={sdSessions.length === 0 ? 'No imported sessions yet' : null}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
