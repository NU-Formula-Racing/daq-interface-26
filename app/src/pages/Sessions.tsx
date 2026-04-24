import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.ts';
import type { Session } from '../api/types.ts';

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    apiGet<Session[]>('/api/sessions').then(setSessions).catch(() => setSessions([]));
  }, []);

  if (sessions === null) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }
  if (sessions.length === 0) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">NO SESSIONS</div>;
  }

  return (
    <div className="p-6 overflow-auto h-full">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-left text-[color:var(--color-text-mute)]">
            <th className="py-2 pr-4">STARTED</th>
            <th className="py-2 pr-4">SOURCE</th>
            <th className="py-2 pr-4">DURATION</th>
            <th className="py-2 pr-4">TRACK</th>
            <th className="py-2 pr-4">DRIVER</th>
            <th className="py-2 pr-4">CAR</th>
            <th className="py-2 pr-4">NOTES</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              className="border-t border-[color:var(--color-border)] hover:bg-[color:var(--color-panel)]/40"
            >
              <td className="py-2 pr-4">{new Date(s.started_at).toLocaleString()}</td>
              <td className="py-2 pr-4">{s.source}</td>
              <td className="py-2 pr-4">{formatDuration(s.started_at, s.ended_at)}</td>
              <td className="py-2 pr-4">{s.track ?? '—'}</td>
              <td className="py-2 pr-4">{s.driver ?? '—'}</td>
              <td className="py-2 pr-4">{s.car ?? '—'}</td>
              <td className="py-2 pr-4 truncate max-w-[14rem]">{s.notes ?? ''}</td>
              <td className="py-2">
                <Link
                  to={`/sessions/${s.id}`}
                  className="text-[color:var(--color-accent)] hover:underline"
                >
                  OPEN →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.round(ms / 1000);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
