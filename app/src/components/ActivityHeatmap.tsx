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

const CELL = 16;
const GAP = 6;
const DAYS = 7;
const LABEL_COL = 56;

const COLORS = [
  '#1e1f22',   // 0 sessions
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
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ActivityHeatmap() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    apiGet<ActivityResponse>('/api/db/activity', {
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    })
      .then(setData)
      .catch(() => setData(null));
  }, [year]);

  // Build vertical week list: row = one week (Sun-Sat). First row = the week
  // containing Jan 1, last row = the week containing Dec 31. Cells outside
  // the year stay as transparent placeholders.
  const { weeks, totalSessions } = useMemo(() => {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const firstSunday = new Date(yearStart);
    firstSunday.setDate(firstSunday.getDate() - firstSunday.getDay());
    const lastSaturday = new Date(yearEnd);
    lastSaturday.setDate(lastSaturday.getDate() + (6 - lastSaturday.getDay()));

    const totalDays =
      Math.round((lastSaturday.getTime() - firstSunday.getTime()) / 86_400_000) + 1;
    const weekCount = totalDays / DAYS;

    const counts = new Map<string, number>();
    if (data) for (const d of data.days) counts.set(d.day, d.sessions);

    type Cell = { date: Date; day: string; count: number; inYear: boolean };
    type Week = { startDate: Date; cells: Cell[]; monthBoundary: number | null };

    const out: Week[] = [];
    let monthSeen = new Set<number>();
    let total = 0;

    for (let w = 0; w < weekCount; w++) {
      const cells: Cell[] = [];
      let monthBoundary: number | null = null;
      for (let d = 0; d < DAYS; d++) {
        const date = new Date(firstSunday);
        date.setDate(firstSunday.getDate() + w * DAYS + d);
        const inYear = date.getFullYear() === year;
        const iso = isoDate(date);
        const count = inYear ? counts.get(iso) ?? 0 : 0;
        if (inYear) total += count;
        cells.push({ date, day: iso, count, inYear });
        if (inYear && !monthSeen.has(date.getMonth())) {
          monthBoundary = date.getMonth();
          monthSeen.add(date.getMonth());
        }
      }
      out.push({ startDate: cells[0].date, cells, monthBoundary });
    }

    return { weeks: out, totalSessions: total };
  }, [data, year]);

  // Split into two columns at the first July week so months 1-6 land left,
  // 7-12 land right. Falls back to a midpoint split if July isn't reached.
  const splitIndex = useMemo(() => {
    const idx = weeks.findIndex((w) => w.monthBoundary === 6); // July = month index 6
    return idx > 0 ? idx : Math.ceil(weeks.length / 2);
  }, [weeks]);

  const renderColumn = (wks: typeof weeks, keyPrefix: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header: day-of-week labels */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${LABEL_COL}px repeat(${DAYS}, ${CELL}px)`,
        columnGap: GAP,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 10,
        color: 'rgba(255,255,255,0.5)',
      }}>
        <span />
        {DOW.map((d, i) => (
          <span key={i} style={{ width: CELL, textAlign: 'center' }}>{d}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
        {wks.map((wk, wi) => (
          <div
            key={`${keyPrefix}-${wi}`}
            style={{
              display: 'grid',
              gridTemplateColumns: `${LABEL_COL}px repeat(${DAYS}, ${CELL}px)`,
              columnGap: GAP,
              alignItems: 'center',
            }}
          >
            <span style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 10,
              color: 'rgba(255,255,255,0.65)',
              letterSpacing: 1.5,
            }}>
              {wk.monthBoundary !== null ? MONTHS[wk.monthBoundary] : ''}
            </span>
            {wk.cells.map((cell) => {
              if (!cell.inYear) {
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
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 6px' }}>
      <span style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 11, color: 'rgba(255,255,255,0.6)',
      }}>
        {totalSessions.toLocaleString()} sessions in {year}
      </span>

      <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        {renderColumn(weeks.slice(0, splitIndex), 'h1')}
        {renderColumn(weeks.slice(splitIndex), 'h2')}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 9,
        color: 'rgba(255,255,255,0.4)',
        marginTop: 6,
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
  );
}
