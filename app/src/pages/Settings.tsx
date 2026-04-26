import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client.ts';
import { ActivityHeatmap } from '../components/ActivityHeatmap.tsx';

interface DbStats {
  sessions: number;
  sd_readings: number;
  rt_readings: number;
  signal_definitions: number;
  database_size: string;
}

export default function Settings() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const [olderThan, setOlderThan] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshStats = () => {
    apiGet<DbStats>('/api/db/stats').then(setStats).catch(() => setStats(null));
  };
  useEffect(() => {
    refreshStats();
  }, []);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 6000);
  };

  const onClear = async () => {
    const before = olderThan
      ? `before ${olderThan}`
      : 'ALL DATA (every session and reading)';
    if (!confirm(`This will permanently delete ${before}. Continue?`)) return;
    setBusy('clear');
    try {
      const body: Record<string, unknown> = {};
      if (olderThan) body.olderThan = new Date(olderThan).toISOString();
      const res = await apiPost<{ sessions_deleted: number }>('/api/db/clear', body);
      flash(`Deleted ${res.sessions_deleted} session(s).`);
      refreshStats();
    } catch (err) {
      flash(`Error: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const tokenParam = (() => {
    const key =
      new URLSearchParams(window.location.search).get('key') ??
      localStorage.getItem('nfr_api_token');
    return key ? `key=${encodeURIComponent(key)}` : '';
  })();

  const onExport = () => {
    const url = tokenParam ? `/api/db/export?${tokenParam}` : '/api/db/export';
    window.location.href = url;
  };

  const onArchive = (format: 'csv' | 'sql') => {
    if (format === 'sql') {
      onExport();
      return;
    }
    const params = new URLSearchParams();
    if (olderThan) params.set('olderThan', new Date(olderThan).toISOString());
    if (tokenParam) {
      const [k, v] = tokenParam.split('=');
      params.set(k, decodeURIComponent(v));
    }
    const qs = params.toString();
    window.location.href = `/api/db/export-range.csv${qs ? `?${qs}` : ''}`;
  };

  const onImportPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm('Importing will REPLACE all current data with the contents of this file. Continue?')) return;
    setBusy('import');
    try {
      const text = await f.text();
      const key =
        new URLSearchParams(window.location.search).get('key') ??
        localStorage.getItem('nfr_api_token');
      const url = key ? `/api/db/import?key=${encodeURIComponent(key)}` : '/api/db/import';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sql' },
        body: text,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        flash(`Import failed: ${(body as any).error ?? res.statusText}`);
      } else {
        flash('Import completed.');
        refreshStats();
      }
    } catch (err) {
      flash(`Error: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-8 overflow-auto h-full font-mono text-xs text-[color:var(--color-text)]">
      <div className="flex flex-wrap gap-10 items-start">
        <div className="max-w-2xl space-y-6 flex-1 min-w-[420px]">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]"
        >
          ← BACK
        </Link>

        <h1 className="text-sm tracking-widest text-[color:var(--color-text)] uppercase">Database</h1>

        <Section title="Stats">
          {stats ? (
            <div className="grid grid-cols-2 gap-y-2 text-[11px]">
              <span className="text-[color:var(--color-text-mute)]">Database size</span>
              <span>{stats.database_size}</span>
              <span className="text-[color:var(--color-text-mute)]">Sessions</span>
              <span>{stats.sessions.toLocaleString()}</span>
              <span className="text-[color:var(--color-text-mute)]">Historical readings (sd_readings)</span>
              <span>{stats.sd_readings.toLocaleString()}</span>
              <span className="text-[color:var(--color-text-mute)]">Live buffer (rt_readings)</span>
              <span>{stats.rt_readings.toLocaleString()}</span>
              <span className="text-[color:var(--color-text-mute)]">Signal catalog</span>
              <span>{stats.signal_definitions.toLocaleString()}</span>
            </div>
          ) : (
            <span className="text-[color:var(--color-text-faint)]">Loading…</span>
          )}
        </Section>

        <Section title="Clear data">
          <p className="text-[11px] text-[color:var(--color-text-mute)]">
            Delete sessions and their readings. Signal catalog and config are preserved.
            Download an archive first if you want to keep this data offline.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
              Only delete sessions older than (optional)
            </span>
            <input
              type="date"
              value={olderThan}
              onChange={(e) => setOlderThan(e.target.value)}
              className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-text)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onArchive('csv')}
              disabled={busy !== null}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest text-[11px] disabled:opacity-50 hover:bg-[color:var(--color-panel)]"
              title="Download a CSV of every reading in the targeted range"
            >
              ↓ Archive as CSV
            </button>
            <button
              onClick={() => onArchive('sql')}
              disabled={busy !== null}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest text-[11px] disabled:opacity-50 hover:bg-[color:var(--color-panel)]"
              title="Download a SQL dump of the entire database (no time filter)"
            >
              ↓ Archive as SQL
            </button>
            <button
              onClick={onClear}
              disabled={busy !== null}
              className="px-3 py-1.5 bg-red-700/30 text-red-200 border border-red-700/50 tracking-widest text-[11px] disabled:opacity-50 hover:bg-red-700/50"
            >
              {busy === 'clear' ? 'Clearing…' : olderThan ? `Clear before ${olderThan}` : 'Clear all data'}
            </button>
          </div>
          <p className="text-[10px] text-[color:var(--color-text-faint)]">
            CSV honors the date filter. SQL is always a full database backup (use the
            Export section below for the same file with no clear pending).
          </p>
        </Section>

        <Section title="Export database">
          <p className="text-[11px] text-[color:var(--color-text-mute)]">
            Downloads a SQL backup of every table (data only). On the destination
            machine, install the app, let it apply migrations, then import this file.
          </p>
          <button
            onClick={onExport}
            disabled={busy !== null}
            className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white tracking-widest text-[11px] disabled:opacity-50"
          >
            ↓ Download backup
          </button>
        </Section>

        <Section title="Import database">
          <p className="text-[11px] text-[color:var(--color-text-mute)]">
            Replace all current data with the contents of a backup file. Existing
            sessions and readings will be removed first.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".sql,application/sql,text/plain"
            style={{ display: 'none' }}
            onChange={onImportPick}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest text-[11px] disabled:opacity-50 hover:bg-[color:var(--color-panel)]"
          >
            {busy === 'import' ? 'Importing…' : '↑ Upload backup'}
          </button>
        </Section>

          {message && (
            <div className="text-[11px] text-[color:var(--color-text-mute)] border border-[color:var(--color-border)] px-3 py-2">
              {message}
            </div>
          )}
        </div>

        <div className="space-y-6 flex-shrink-0" style={{ minWidth: 760 }}>
          <Section title="Activity">
            <ActivityHeatmap />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{title}</legend>
      {children}
    </fieldset>
  );
}
