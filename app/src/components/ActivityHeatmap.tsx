import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../api/client.ts';

interface DayCount {
  day: string;     // 'YYYY-MM-DD'
  sessions: number;
}

interface ActivityResponse {
  from: string;
  to: string;
  days: DayCount[];
}

const CELL = 12;
const GAP = 3;
const WEEKS = 53;
const DAYS = 7;

// Five-step ramp from "no activity" to "very busy" — accent purple at the top.
const COLORS = [
  '#1e1f22',   // 0 sessions — same as bg
  '#2b2d30',   // 1
  '#4e2a84',   // 2
  '#7c4ec1',   // 3
  '#a78bfa',   // 4+
];

function bucket(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ActivityHeatmap() {
  const [data, setData] = useState<ActivityResponse | null>(null);

  useEffect(() => {
    apiGet<ActivityResponse>('/api/db/activity').then(setData).catch(() => setData(null));
  }, []);

  // Build a 53-week × 7-day grid ending today, with each cell tagged with its
  // ISO date and session count. Empty days get count=0.
  const grid = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // End column = current week. Snap to Saturday so the last column is always full.
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
    const start = new Date(endOfWeek);
    start.setDate(start.getDate() - (WEEKS * DAYS - 1));

    const counts = new Map<string, number>();
    if (data) {
      for (const d of data.days) counts.set(d.day, d.sessions);
    }

    const cells: { date: Date; day: string; count: number }[][] = [];
    for (let w = 0; w < WEEKS; w++) {
      const week: { date: Date; day: string; count: number }[] = [];
      for (let d = 0; d < DAYS; d++) {
        const idx = w * DAYS + d;
        const date = new Date(start);
        date.setDate(start.getDate() + idx);
        const iso = date.toISOString().slice(0, 10);
        week.push({ date, day: iso, count: counts.get(iso) ?? 0 });
      }
      cells.push(week);
    }
    return cells;
  }, [data]);

  // Month labels — show a label when the first day of the week is in a new month.
  const monthLabels = useMemo(() => {
    const seen = new Set<number>();
    return grid.map((week, wi) => {
      const m = week[0].date.getMonth();
      if (seen.has(m)) return { wi, label: '' };
      seen.add(m);
      // Skip showing "Jan" twice if the year starts mid-grid; the Set guards that.
      return { wi, label: MONTHS[m] };
    });
  }, [grid]);

  const totalSessions = useMemo(
    () => grid.flat().reduce((acc, c) => acc + c.count, 0),
    [grid],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        fontFamily: '"JetBrains Mono", monospace',
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
          {totalSessions.toLocaleString()} sessions in the last year
        </span>
      </div>

      {/* Grid */}
      <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
        {/* Month labels row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${WEEKS}, ${CELL}px)`,
          columnGap: GAP,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 9,
          color: 'rgba(255,255,255,0.5)',
          height: 12,
        }}>
          {monthLabels.map((m) => (
            <span key={m.wi} style={{ whiteSpace: 'nowrap' }}>{m.label}</span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          {/* Day-of-week labels */}
          <div style={{
            display: 'grid',
            gridTemplateRows: `repeat(${DAYS}, ${CELL}px)`,
            rowGap: GAP,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 9,
            color: 'rgba(255,255,255,0.4)',
            paddingTop: 1,
          }}>
            {['', 'M', '', 'W', '', 'F', ''].map((l, i) => (
              <span key={i} style={{ height: CELL, lineHeight: `${CELL}px` }}>{l}</span>
            ))}
          </div>

          {/* Cells */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${WEEKS}, ${CELL}px)`,
            gridAutoFlow: 'column',
            columnGap: GAP,
            rowGap: GAP,
          }}>
            {grid.flat().map((cell) => {
              const inFuture = cell.date > new Date();
              return (
                <div
                  key={cell.day}
                  title={`${cell.day} — ${cell.count} session${cell.count === 1 ? '' : 's'}`}
                  style={{
                    width: CELL, height: CELL,
                    background: inFuture ? 'transparent' : COLORS[bucket(cell.count)],
                    borderRadius: 2,
                    border: cell.count === 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 9,
          color: 'rgba(255,255,255,0.4)',
          marginTop: 4,
        }}>
          <span>Less</span>
          {COLORS.map((c, i) => (
            <span
              key={i}
              style={{
                width: CELL, height: CELL, background: c, borderRadius: 2,
                border: i === 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
