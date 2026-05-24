import { useState, useMemo } from 'react';
import type { CloudDayGroup } from '../api/client.ts';

function humanBytes(n: number): string {
  if (n < 1_000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} KB`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  return `${(n / 1_000_000_000).toFixed(2)} GB`;
}

export interface StorageCloudTabProps {
  groups: CloudDayGroup[];
  pullSessions: (ids: string[]) => Promise<{ results: Array<{ id: string; ok: boolean; error?: string; rowCount?: number }> }>;
}

export function StorageCloudTab({ groups, pullSessions }: StorageCloudTabProps) {
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [showWarning, setShowWarning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const idsToPull = useMemo(() => {
    const ids: string[] = [];
    for (const g of groups) if (selectedDays.has(g.date))
      for (const s of g.sessions) if (!s.alreadyLocal) ids.push(s.id);
    return ids;
  }, [groups, selectedDays]);

  const bytesToPull = useMemo(() => {
    let n = 0;
    for (const g of groups) if (selectedDays.has(g.date))
      for (const s of g.sessions) if (!s.alreadyLocal) n += s.totalBytes;
    return n;
  }, [groups, selectedDays]);

  const toggleDay = (date: string) => setSelectedDays((s) => {
    const n = new Set(s); n.has(date) ? n.delete(date) : n.add(date); return n;
  });

  const confirm = async () => {
    setShowWarning(false);
    const r = await pullSessions(idsToPull);
    const m: Record<string, { ok: boolean; msg: string }> = {};
    for (const x of r.results) m[x.id] = { ok: x.ok, msg: x.ok ? `pulled ${x.rowCount} rows` : (x.error ?? 'failed') };
    setStatuses(m);
  };

  return (
    <div>
      <button disabled={idsToPull.length === 0} onClick={() => setShowWarning(true)}>
        Pull selected
      </button>
      {groups.map((g) => (
        <details key={g.date}>
          <summary>
            <input type="checkbox" aria-label={`select-day-${g.date}`}
              checked={selectedDays.has(g.date)} onChange={() => toggleDay(g.date)} />
            {g.date} — {humanBytes(g.totalBytes)} — {g.sessions.length} session(s)
          </summary>
          <ul>
            {g.sessions.map((s) => (
              <li key={s.id}>
                {s.id.slice(0, 8)}
                {s.alreadyLocal ? ' (already local)' : ''}
                {statuses[s.id] && (
                  <span> — {statuses[s.id].ok ? 'OK' : 'ERROR'}: {statuses[s.id].msg}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {showWarning && (
        <div role="dialog">
          <p>You are about to download {idsToPull.length} sessions, ~{humanBytes(bytesToPull)} total, and import them into your local database.</p>
          <button onClick={() => setShowWarning(false)}>Cancel</button>
          <button onClick={confirm}>Continue</button>
        </div>
      )}
    </div>
  );
}
