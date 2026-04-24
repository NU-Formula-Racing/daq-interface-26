import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface Status {
  pg: 'ok' | 'not_reachable';
  lastError: string | null;
}

export default function Setup() {
  const [status, setStatus] = useState<Status>({ pg: 'not_reachable', lastError: null });
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const tick = () => apiGet<Status>('/api/setup/status').then(setStatus).catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

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

  return (
    <div className="h-full flex items-center justify-center p-8 font-mono text-[color:var(--color-text)]">
      <div className="max-w-lg w-full space-y-6">
        <h1 className="text-lg tracking-widest">NFR · SETUP REQUIRED</h1>
        <div className="text-xs text-[color:var(--color-text-mute)] space-y-2">
          <p>The NFR local app needs a running PostgreSQL server on <code>localhost:5432</code> with a trust connection for the <code>postgres</code> user.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>macOS:</strong> install <a className="underline" href="https://postgresapp.com/" target="_blank" rel="noreferrer">Postgres.app</a> and launch it. The default install creates a <code>postgres</code> superuser with no password.</li>
            <li><strong>Windows:</strong> download the installer from <a className="underline" href="https://www.postgresql.org/download/windows/" target="_blank" rel="noreferrer">postgresql.org</a>. Keep the default port 5432 and remember the password for <code>postgres</code>.</li>
            <li><strong>Linux:</strong> <code>sudo apt install postgresql</code> (or the equivalent for your distro), then <code>sudo -u postgres psql</code> to verify.</li>
          </ul>
          <p>After Postgres is running, click RETRY below.</p>
        </div>
        {status.lastError && (
          <pre className="text-[10px] text-[color:var(--color-text-faint)] whitespace-pre-wrap">{status.lastError}</pre>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={retry}
            disabled={retrying}
            className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
          >
            {retrying ? 'RETRYING…' : 'RETRY'}
          </button>
          <span className="text-[11px] text-[color:var(--color-text-mute)]">{message}</span>
        </div>
      </div>
    </div>
  );
}
