import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

type Backend = 'supabase' | 'postgres';

interface SyncStatus {
  cloudBackend: Backend | null;
  configured: boolean;
  hasSupabaseUrl: boolean;
  hasSupabaseKey: boolean;
  hasPgUrl: boolean;
  unsyncedSessions: number;
  syncedSessions: number;
  lastSyncedAt: string | null;
}

interface PushResult {
  pushed: number;
  failed: number;
}

const PLACEHOLDER_SET = '••••• (set)';

export function CloudSync() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [backend, setBackend] = useState<Backend>('supabase');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [pgUrl, setPgUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const refresh = () => {
    apiGet<SyncStatus>('/api/sync/status')
      .then((s) => {
        setStatus(s);
        if (s.cloudBackend) setBackend(s.cloudBackend);
      })
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refresh();
  }, []);

  const flashError = (msg: string) => {
    setError(msg);
    setInfo('');
    setTimeout(() => setError(''), 8000);
  };
  const flashInfo = (msg: string) => {
    setInfo(msg);
    setError('');
    setTimeout(() => setInfo(''), 6000);
  };

  const onSave = async () => {
    setBusy('save');
    try {
      const patch: Record<string, string> = { cloudBackend: backend };
      // Only include fields the user actually typed — empty string is treated
      // by the backend as "clear", so we skip them unless the user explicitly
      // wants to overwrite.
      if (supabaseUrl) patch.supabaseUrl = supabaseUrl;
      if (supabaseAnonKey) patch.supabaseAnonKey = supabaseAnonKey;
      if (pgUrl) patch.cloudPgUrl = pgUrl;
      await apiPost('/api/sync/config', patch);
      // Wipe inputs so we don't show the user's just-typed creds back at them.
      setSupabaseUrl('');
      setSupabaseAnonKey('');
      setPgUrl('');
      flashInfo('Saved.');
      refresh();
    } catch (err) {
      flashError(`Save failed: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const onPush = async () => {
    if (!status?.configured) return;
    setBusy('push');
    try {
      const res = await apiPost<PushResult>('/api/sync/push', {});
      flashInfo(`Pushed ${res.pushed} session(s); ${res.failed} failed.`);
      refresh();
    } catch (err) {
      flashError(`Sync failed: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const lastSyncDisplay = status?.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString()
    : '—';

  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
        Cloud sync
      </legend>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="border border-[color:var(--color-border)] px-3 py-2">
          <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">
            UNSYNCED
          </div>
          <div className="text-[14px] font-mono">
            {status?.unsyncedSessions ?? '—'}
          </div>
        </div>
        <div className="border border-[color:var(--color-border)] px-3 py-2">
          <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">
            SYNCED
          </div>
          <div className="text-[14px] font-mono">
            {status?.syncedSessions ?? '—'}
          </div>
        </div>
        <div className="border border-[color:var(--color-border)] px-3 py-2">
          <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">
            LAST SYNC
          </div>
          <div className="text-[11px] font-mono">{lastSyncDisplay}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
          BACKEND
        </div>
        <div className="flex gap-4 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="cloud-backend"
              checked={backend === 'supabase'}
              onChange={() => setBackend('supabase')}
              className="accent-[color:var(--color-accent)]"
            />
            <span>Supabase (REST)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="cloud-backend"
              checked={backend === 'postgres'}
              onChange={() => setBackend('postgres')}
              className="accent-[color:var(--color-accent)]"
            />
            <span>Postgres URL (any provider)</span>
          </label>
        </div>
      </div>

      {backend === 'supabase' && (
        <div className="space-y-2">
          <label className="block text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
            SUPABASE URL
            <input
              type="text"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder={
                status?.hasSupabaseUrl ? PLACEHOLDER_SET : 'https://xxx.supabase.co'
              }
              className="mt-1 w-full bg-transparent border border-[color:var(--color-border)] px-2 py-1 text-[11px] font-mono"
            />
          </label>
          <label className="block text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
            SUPABASE ANON KEY
            <input
              type="password"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder={status?.hasSupabaseKey ? PLACEHOLDER_SET : 'eyJ…'}
              className="mt-1 w-full bg-transparent border border-[color:var(--color-border)] px-2 py-1 text-[11px] font-mono"
            />
          </label>
        </div>
      )}

      {backend === 'postgres' && (
        <div className="space-y-2">
          <label className="block text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
            POSTGRES CONNECTION STRING
            <input
              type="password"
              value={pgUrl}
              onChange={(e) => setPgUrl(e.target.value)}
              placeholder={
                status?.hasPgUrl ? PLACEHOLDER_SET : 'postgresql://user:pw@host:5432/db'
              }
              className="mt-1 w-full bg-transparent border border-[color:var(--color-border)] px-2 py-1 text-[11px] font-mono"
            />
          </label>
          <p className="text-[10px] text-[color:var(--color-text-mute)] leading-relaxed">
            Works with any libpq-compatible Postgres: Supabase direct
            (db.&lt;ref&gt;.supabase.co), Hetzner, Heroku Postgres, RDS, etc.
            Cloud schema needs the same tables and the unique constraint on
            (session_id, ts, signal_id).
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={busy !== null}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          {busy === 'save' ? 'SAVING…' : 'SAVE'}
        </button>
        <button
          onClick={onPush}
          disabled={busy !== null || !status?.configured}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
          title={!status?.configured ? 'Configure and save credentials first' : ''}
        >
          {busy === 'push' ? 'SYNCING…' : 'SYNC NOW'}
        </button>
      </div>

      {info && (
        <div className="text-[11px] text-[color:var(--color-text)] border border-[color:var(--color-border)] px-3 py-2">
          {info}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-300 border border-red-700/50 px-3 py-2">
          {error}
        </div>
      )}
    </fieldset>
  );
}
