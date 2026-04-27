import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api/client.ts';

interface Status {
  pg: 'ok' | 'not_reachable' | 'storage_disconnected';
  lastError: string | null;
}

export default function Setup() {
  const nav = useNavigate();
  const [status, setStatus] = useState<Status>({ pg: 'not_reachable', lastError: null });
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const tick = () => apiGet<Status>('/api/setup/status').then(setStatus).catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  // If the server reports "no active database", that's a fresh-install
  // condition — send the user straight to the storage picker.
  useEffect(() => {
    if (status.lastError && /no active database/i.test(status.lastError)) {
      nav('/storage-setup', { replace: true });
    }
  }, [status.lastError, nav]);

  useEffect(() => {
    if (status.pg === 'ok') {
      setTimeout(() => window.location.reload(), 1500);
    }
  }, [status]);

  const retry = async () => {
    setRetrying(true);
    setMessage('Retrying…');
    try {
      const result = await apiPost<{ ok: boolean; error?: string }>('/api/setup/retry', {});
      if (result.ok) setMessage('Connected. Reloading…');
      else setMessage(result.error ?? 'Still unreachable');
    } catch (err) {
      setMessage(String(err));
    } finally {
      setRetrying(false);
    }
  };

  const headline =
    status.pg === 'storage_disconnected'
      ? 'STORAGE DISCONNECTED'
      : 'DATABASE UNREACHABLE';

  const explainer =
    status.pg === 'storage_disconnected'
      ? 'The drive holding your active database is no longer connected. Plug it back in and click RETRY, or choose a different location for a clean install.'
      : 'The embedded Postgres server failed to start. Try again, or pick a new storage location for a clean install.';

  return (
    <div className="h-full flex items-center justify-center p-8 font-mono text-[color:var(--color-text)]">
      <div className="max-w-lg w-full space-y-6">
        <h1 className="text-lg tracking-widest">NFR · {headline}</h1>
        <p className="text-xs text-[color:var(--color-text-mute)] leading-relaxed">{explainer}</p>
        {status.lastError && (
          <pre className="text-[10px] text-[color:var(--color-text-faint)] whitespace-pre-wrap border border-[color:var(--color-border)] p-2">{status.lastError}</pre>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={retry}
            disabled={retrying}
            className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
          >
            {retrying ? 'RETRYING…' : 'RETRY'}
          </button>
          <button
            onClick={() => nav('/storage-setup')}
            className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest hover:bg-[color:var(--color-panel)]"
          >
            CHOOSE NEW LOCATION (CLEAN INSTALL)
          </button>
          <span className="text-[11px] text-[color:var(--color-text-mute)]">{message}</span>
        </div>
      </div>
    </div>
  );
}
