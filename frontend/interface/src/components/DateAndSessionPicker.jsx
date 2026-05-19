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
 *  - formatSessionLabel(session) -> string (optional)
 */
export default function DateAndSessionPicker({
  sessions,
  selectedDate,
  onSelectedDate,
  sessionId,
  onSessionId,
  formatSessionLabel,
}) {
  const dayLabel = (s) => {
    if (formatSessionLabel) return formatSessionLabel(s);
    const t = s.started_at ? new Date(s.started_at).toISOString().slice(11, 19) : "?";
    const dur = s.duration_secs != null ? ` · ${s.duration_secs}s` : "";
    return `${t}${dur}`;
  };

  const sessionsForDate = useMemo(
    () => sessions.filter((s) => s.date === selectedDate),
    [sessions, selectedDate],
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <DatePicker value={selectedDate} onChange={onSelectedDate} />
      <select
        value={sessionId ?? ""}
        onChange={(e) => onSessionId(e.target.value || null)}
        style={inputStyle}
      >
        {sessionsForDate.length === 0 && <option value="">No sessions</option>}
        {sessionsForDate.map((s) => (
          <option key={s.id} value={s.id}>{dayLabel(s)}</option>
        ))}
      </select>
    </div>
  );
}
