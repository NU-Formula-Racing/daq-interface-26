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

const CELL = 11;
const GAP = 2;
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

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ActivityHeatmap() {
  const [data, setData] = useState<ActivityResponse | null>(null);

  // Fetch the current year's data. Server defaults are last-53-weeks; we
  // pass explicit `from`/`to` so the response matches the rendered range.
  const year = new Date().getFullYear();
  useEffect(() => {
    apiGet<ActivityResponse>('/api/db/activity', {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    })
      .then(setData)
      .catch(() => setData(null));
  }, [year]);

  // Build the calendar grid:
  //   - First column = the Sunday on/before Jan 1 of the current year
  //   - Last column = the Saturday on/after Dec 31 of the current year
  //   - Cells outside [Jan 1, Dec 31] are rendered as empty placeholders.
  const { grid, monthLabels } = useMemo(() => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const firstSunday = new Date(yearStart);
    firstSunday.setDate(firstSunday.getDate() - firstSunday.getDay());
    const lastSaturday = new Date(yearEnd);
    lastSaturday.setDate(lastSaturday.getDate() + (6 - lastSaturday.getDay()));

    const totalDays =
      Math.round((lastSaturday.getTime() - firstSunday.getTime()) / 86_400_000) + 1;
    const weeks = totalDays / DAYS;

    const counts = new Map<string, number>();
    if (data) for (const d of data.days) counts.set(d.day, d.sessions);

    const cells: { date: Date; day: string; count: number; inYear: boolean }[][] = [];
    for (let w = 0; w < weeks; w++) {
      const week: { date: Date; day: string; count: number; inYear: boolean }[] = [];
      for (let d = 0; d < DAYS; d++) {
        const date = new Date(firstSunday);
        date.setDate(firstSunday.getDate() + w * DAYS + d);
        const iso = isoDate(date);
        const inYear = date.getFullYear() === year;
        week.push({ date, day: iso, count: inYear ? counts.get(iso) ?? 0 : 0, inYear });
      }
      cells.push(week);
    }

    // Month labels — show on the first week where Sunday is in a new month
    // AND that month is the year we're rendering.
    const seen = new Set<number>();
    const labels = cells.map((week, wi) => {
      const first = week.find((c) => c.inYear);
      if (!first) return { wi, label: '' };
      const m = first.date.getMonth();
      if (seen.has(m)) return { wi, label: '' };
      seen.add(m);
      return { wi, label: MONTHS[m] };
    });

    return { grid: cells, monthLabels: labels };
  }, [data, year]);

  const totalSessions = useMemo(
    () => grid.flat().reduce((acc, c) => acc + c.count, 0),
    [grid],
  );
  const totalWeeks = grid.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        fontFamily: '"JetBrains Mono", monospace',
      }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
          {totalSessions.toLocaleString()} sessions in {year}
        </span>
      </div>

      <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
        {/* Month labels row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${totalWeeks}, ${CELL}px)`,
          columnGap: GAP,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 9,
          color: 'rgba(255,255,255,0.5)',
          height: 12,
          paddingLeft: 14, // align with cells (after dow column)
        }}>
          {monthLabels.map((m) => (
            <span key={m.wi} style={{ whiteSpace: 'nowrap' }}>{m.label}</span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          {/* Day-of-week labels */}
          <div style={{
            display: 'grid',
            gridTemplateRows: `repeat(${DAYS}, ${CELL}px)`,
            rowGap: GAP,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 9,
            color: 'rgba(255,255,255,0.4)',
          }}>
            {['', 'M', '', 'W', '', 'F', ''].map((l, i) => (
              <span key={i} style={{ height: CELL, lineHeight: `${CELL}px` }}>{l}</span>
            ))}
          </div>

          {/* Cells */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${totalWeeks}, ${CELL}px)`,
            gridAutoFlow: 'column',
            columnGap: GAP,
            rowGap: GAP,
          }}>
            {grid.flat().map((cell) => {
              if (!cell.inYear) {
                // Placeholder so column alignment stays correct, but invisible.
                return (
                  <div
                    key={cell.day}
                    style={{ width: CELL, height: CELL, background: 'transparent' }}
                  />
                );
              }
              return (
                <div
                  key={cell.day}
                  title={`${cell.day} — ${cell.count} session${cell.count === 1 ? '' : 's'}`}
                  style={{
                    width: CELL, height: CELL,
                    background: COLORS[bucket(cell.count)],
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
