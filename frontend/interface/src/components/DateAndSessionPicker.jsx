import { useMemo } from "react";
import DatePicker from "@/components/DatePicker";

const inputStyle = {
  background: "var(--hud-bg, #2b2d30)",
  border: "1px solid rgba(255,255,255,0.16)",
  fontFamily: "var(--font-mono, \"JetBrains Mono\", monospace)",
  fontSize: "0.8rem",
  color: "#f0f0f0",
  borderRadius: "4px",
  padding: "4px 8px",
  outline: "none",
};

/**
 * Calendar date picker + dropdown of sessions on that date.
 *
 * Props:
 *  - sessions: SessionListItem[]   all sessions known to the app
 *  - selectedDate: 'YYYY-MM-DD' string
 *  - onSelectedDate(date)
 *  - sessionId: string | null
 *  - onSessionId(id)
 *  - formatSessionLabel(session, dayIndex) -> string (optional)
 *
 *  `dayIndex` is the 1-based chronological position of the session within
 *  the selected date (earliest = 1). Falls back to `s.session_number` when
 *  the DB column happens to be populated.
 */
export default function DateAndSessionPicker({
  sessions,
  selectedDate,
  onSelectedDate,
  sessionId,
  onSessionId,
  formatSessionLabel,
  liveSessions = [],
}) {
  const sessionsForDate = useMemo(
    () =>
      sessions
        .filter((s) => s.date === selectedDate)
        .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? "")),
    [sessions, selectedDate],
  );

  const dayLabel = (s, idx) => {
    const num = s.session_number ?? idx + 1;
    if (formatSessionLabel) return formatSessionLabel(s, num);
    const t = s.started_at
      ? new Date(s.started_at).toLocaleTimeString([], {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        })
      : "?";
    const dur = s.duration_secs != null ? ` · ${s.duration_secs}s` : "";
    return `#${num} · ${t}${dur}`;
  };

  const liveLabel = (s) => {
    const t = new Date(s.started_at).toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const status = s.ended_at ? "ENDED" : "LIVE";
    return `${status} · ${t}${s.machine ? ` · ${s.machine}` : ""}`;
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <DatePicker value={selectedDate} onChange={onSelectedDate} />
      <select
        value={sessionId ?? ""}
        onChange={(e) => onSessionId(e.target.value || null)}
        style={inputStyle}
      >
        {liveSessions.length > 0 && (
          <optgroup label="● LIVE (last 12h)">
            {liveSessions.map((s) => (
              <option key={s.id} value={s.id}>{liveLabel(s)}</option>
            ))}
          </optgroup>
        )}
        {liveSessions.length > 0 && sessionsForDate.length > 0 && (
          <optgroup label={`Date — ${selectedDate}`}>
            {sessionsForDate.map((s, idx) => (
              <option key={s.id} value={s.id}>{dayLabel(s, idx)}</option>
            ))}
          </optgroup>
        )}
        {liveSessions.length === 0 && sessionsForDate.length === 0 && (
          <option value="">No sessions</option>
        )}
        {liveSessions.length === 0 && sessionsForDate.map((s, idx) => (
          <option key={s.id} value={s.id}>{dayLabel(s, idx)}</option>
        ))}
      </select>
    </div>
  );
}
