import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../api/client.ts';
import type { Session } from '../api/types.ts';
import { COLORS as SH_COLORS } from './colors.ts';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function smallBtn(): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${SH_COLORS.border}`, color: SH_COLORS.textMute,
    fontFamily: '"JetBrains Mono", monospace', fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}

function CalendarPanel({
  cursor, cells, onPrev, onNext, onToday, onPickDate, emptyHint,
}: {
  cursor: Date;
  cells: Array<{ date: Date; iso: string; inMonth: boolean; sessions: number }>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPickDate: (iso: string) => void;
  emptyHint: string | null;
}) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div style={{ padding: 12, fontFamily: '"JetBrains Mono", monospace' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <button onClick={onPrev} style={{ ...smallBtn(), padding: '2px 8px' }}>‹</button>
        <span style={{
          fontSize: 11, color: SH_COLORS.text, letterSpacing: 1, fontWeight: 600,
        }}>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onToday} style={{ ...smallBtn(), padding: '2px 6px', fontSize: 9 }}>TODAY</button>
          <button onClick={onNext} style={{ ...smallBtn(), padding: '2px 8px' }}>›</button>
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2,
        marginBottom: 4, fontSize: 9, color: SH_COLORS.textFaint,
      }}>
        {DOW_LABELS.map((d, i) => (
          <span key={i} style={{ textAlign: 'center', padding: '2px 0' }}>{d}</span>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
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
                aspectRatio: '1 / 1',
                padding: 0,
                background: has
                  ? 'rgba(167,139,250,0.22)'
                  : 'transparent',
                border: isToday
                  ? `1px solid ${SH_COLORS.accentBright}`
                  : `1px solid ${has ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.05)'}`,
                color: has
                  ? SH_COLORS.text
                  : dim
                    ? SH_COLORS.textFaint
                    : SH_COLORS.textMute,
                cursor: has ? 'pointer' : 'default',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10,
                display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                position: 'relative',
                opacity: dim ? 0.4 : 1,
              }}
              title={has ? `${c.sessions} session${c.sessions === 1 ? '' : 's'}` : ''}
            >
              {c.date.getDate()}
              {has && c.sessions > 1 && (
                <span style={{
                  position: 'absolute', bottom: 2, right: 4,
                  fontSize: 8, color: SH_COLORS.accentBright,
                }}>
                  {c.sessions}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {emptyHint && (
        <div style={{
          marginTop: 10, fontSize: 9, color: SH_COLORS.textFaint, textAlign: 'center',
        }}>
          {emptyHint}
        </div>
      )}
    </div>
  );
}

function SessionDayList({
  date, sessions, currentId, onPick, onBack,
}: {
  date: string;
  sessions: Session[];
  currentId: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: `1px solid ${SH_COLORS.border}`,
      }}>
        <button onClick={onBack} style={{ ...smallBtn(), padding: '2px 8px', fontSize: 9 }}>
          ← BACK
        </button>
        <span style={{ fontSize: 10, color: SH_COLORS.textMute, letterSpacing: 1 }}>
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
              padding: '10px 12px',
              borderBottom: `1px solid ${SH_COLORS.border}`,
              cursor: 'pointer',
              background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
              fontSize: 10, color: SH_COLORS.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{new Date(s.started_at).toLocaleTimeString()}</span>
              <span style={{ color: SH_COLORS.textFaint, fontSize: 9 }}>
                {s.source_file ? s.source_file.split('/').slice(-1)[0] : s.id.slice(0, 8)}
              </span>
            </div>
            <div style={{
              marginTop: 2, color: SH_COLORS.textMute, fontSize: 9,
              display: 'flex', gap: 8,
            }}>
              <span>{s.id.slice(0, 8)}</span>
              {s.track && <span>· {s.track}</span>}
              {s.driver && <span>· {s.driver}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LiveGroup({
  sessions, currentId, onPick,
}: {
  sessions: Session[];
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${SH_COLORS.border}` }}>
      <div style={{
        padding: '8px 12px 4px',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 9, letterSpacing: 1.5,
        color: '#fbbf24',
      }}>
        ● MOST RECENT LIVE SESSION
      </div>
      {sessions.map((s) => {
        const active = s.id === currentId;
        const ended = s.ended_at !== null;
        return (
          <div
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              color: SH_COLORS.text,
              borderTop: `1px solid ${SH_COLORS.border}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span>{new Date(s.started_at).toLocaleString()}</span>
              <span style={{
                fontSize: 8, letterSpacing: 1.5,
                color: ended ? SH_COLORS.textFaint : '#fbbf24',
                border: `1px solid ${ended ? SH_COLORS.border : 'rgba(251,191,36,0.6)'}`,
                padding: '1px 5px',
              }}>
                {ended ? 'ENDED' : 'LIVE'}
              </span>
            </div>
            <div style={{ marginTop: 2, color: SH_COLORS.textMute, fontSize: 9 }}>
              {s.id.slice(0, 8)}
              {s.track && ` · ${s.track}`}
              {s.driver && ` · ${s.driver}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SessionPicker() {
  const navigate = useNavigate();
  const params = useParams();
  const currentId = params.id ?? null;

  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  // Track whether we've auto-jumped the cursor for this open session so we
  // don't override the user's manual ‹ › navigation.
  const autoJumpedRef = useRef(false);

  // Fetch sessions whenever (a) the dropdown opens, or (b) the current
  // session id changes — including on initial mount when an id is in the
  // URL. This keeps the label able to resolve `id → date` immediately.
  useEffect(() => {
    if (!open && currentId === null) return;
    apiGet<Session[]>('/api/sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [open, currentId]);

  // Reset drill-in state on close.
  useEffect(() => {
    if (!open) {
      setSelectedDate(null);
      autoJumpedRef.current = false;
    }
  }, [open]);

  // First time we have sessions for this open session, jump the cursor to the
  // latest month that contains an sd_import session (so users land on data).
  useEffect(() => {
    if (!open || autoJumpedRef.current || sessions === null) return;
    const sd = sessions.filter((s) => s.source === 'sd_import');
    if (sd.length === 0) {
      autoJumpedRef.current = true;
      return;
    }
    const latest = sd.reduce((acc, s) => (s.date > acc ? s.date : acc), sd[0].date);
    // latest is YYYY-MM-DD
    const [y, m] = latest.split('-').map((x) => parseInt(x, 10));
    if (y && m) setCursor(new Date(y, m - 1, 1));
    autoJumpedRef.current = true;
  }, [open, sessions]);

  // SD imports drive the calendar view (one logical day per cell). Live
  // sessions get their own group above the calendar — they're short, you
  // only ever have one or two, and they don't make sense on a date grid.
  const sdSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.source === 'sd_import'),
    [sessions],
  );
  // Only ever surface the most-recent live session. The live-sync worker
  // wipes prior local live sessions on each new session_started, so under
  // normal flow there is at most one anyway; this guards against any
  // leftovers from an aborted prior run.
  const liveSessions = useMemo(() => {
    const list = (sessions ?? [])
      .filter((s) => s.source === 'live')
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
    return list.length > 0 ? [list[0]] : [];
  }, [sessions]);

  // YYYY-MM-DD → Session[]
  const dayMap = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of sdSessions) {
      const arr = m.get(s.date);
      if (arr) arr.push(s);
      else m.set(s.date, [s]);
    }
    return m;
  }, [sdSessions]);

  const current = sessions?.find((s) => s.id === currentId);
  const label = currentId
    ? current
      ? `${new Date(current.started_at).toLocaleDateString()} · ${currentId.slice(0, 8)}`
      : currentId.slice(0, 8)
    : 'Select session';

  // Build a 6×7 calendar grid for `cursor`'s month.
  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startSunday = new Date(firstOfMonth);
    startSunday.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    const out: Array<{
      date: Date;
      iso: string;
      inMonth: boolean;
      sessions: number;
    }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({
        date: d,
        iso,
        inMonth: d.getMonth() === cursor.getMonth(),
        sessions: dayMap.get(iso)?.length ?? 0,
      });
    }
    return out;
  }, [cursor, dayMap]);

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', top: 'calc(100% + 4px)', right: 0,
    width: 380, maxHeight: 460, overflow: 'auto',
    background: SH_COLORS.bg,
    border: `1px solid ${SH_COLORS.border}`,
    zIndex: 51,
    boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...smallBtn(), color: SH_COLORS.text, padding: '4px 10px' }}
      >
        {label} ▾
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
          />
          <div style={dropdownStyle}>
            {sessions === null ? (
              <div style={{ padding: 14, fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: SH_COLORS.textFaint }}>
                Loading…
              </div>
            ) : selectedDate ? (
              <SessionDayList
                date={selectedDate}
                sessions={dayMap.get(selectedDate) ?? []}
                currentId={currentId}
                onPick={(id) => {
                  navigate(`/sessions/${id}`);
                  setOpen(false);
                }}
                onBack={() => setSelectedDate(null)}
              />
            ) : (
              <>
                {liveSessions.length > 0 && (
                  <LiveGroup
                    sessions={liveSessions}
                    currentId={currentId}
                    onPick={(id) => {
                      navigate(`/sessions/${id}`);
                      setOpen(false);
                    }}
                  />
                )}
                <CalendarPanel
                  cursor={cursor}
                  cells={cells}
                  onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                  onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                  onToday={() => {
                    const now = new Date();
                    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                  }}
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
