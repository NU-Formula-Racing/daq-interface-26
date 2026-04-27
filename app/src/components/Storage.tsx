import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface CatalogEntry {
  name: string;
  path: string;
  lastUsed?: string;
  reachable: boolean;
}

interface CatalogResponse {
  active: string | null;
  entries: CatalogEntry[];
}

interface ProbeResponse {
  exists: boolean;
  hasPgVersion: boolean;
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'delete'; entry: CatalogEntry }
  | { kind: 'add'; mode: 'create' | 'connect'; path: string; existing: boolean };

export function Storage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string>('');
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [manualPath, setManualPath] = useState<string>('');
  const [manualMode, setManualMode] = useState<'create' | 'connect' | null>(null);

  const refresh = () => {
    apiGet<CatalogResponse>('/api/db/catalog')
      .then(setCatalog)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  const triggerRestart = () => {
    setRestarting(true);
    setTimeout(() => window.location.reload(), 1200);
  };

  const flashError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(''), 6000);
  };

  const onSwitch = async (path: string) => {
    setBusy(`switch:${path}`);
    try {
      await apiPost('/api/db/catalog/switch', { path });
      triggerRestart();
    } catch (err) {
      flashError(`Switch failed: ${String(err)}`);
      setBusy(null);
    }
  };

  const onRemove = async (path: string) => {
    if (!confirm('Remove this entry from the list? Files on disk are kept.')) return;
    setBusy(`remove:${path}`);
    try {
      const res = await apiPost<{ ok: boolean; restarting: boolean }>(
        '/api/db/catalog/remove',
        { path },
      );
      if (res.restarting) triggerRestart();
      else {
        refresh();
        setBusy(null);
      }
    } catch (err) {
      flashError(`Remove failed: ${String(err)}`);
      setBusy(null);
    }
  };

  const onDelete = async (path: string) => {
    setBusy(`delete:${path}`);
    try {
      const res = await apiPost<{ ok: boolean; restarting: boolean }>(
        '/api/db/catalog/delete',
        { path, confirm: true },
      );
      setDialog({ kind: 'none' });
      if (res.restarting) triggerRestart();
      else {
        refresh();
        setBusy(null);
      }
    } catch (err) {
      flashError(`Delete failed: ${String(err)}`);
      setBusy(null);
    }
  };

  const probeAndDialog = async (path: string, fallbackMode: 'create' | 'connect') => {
    try {
      const probe = await apiGet<ProbeResponse>('/api/db/probe', { path });
      const mode: 'create' | 'connect' = probe.hasPgVersion ? 'connect' : 'create';
      // If the user explicitly chose connect but there's no PG_VERSION, surface the mismatch
      if (fallbackMode === 'connect' && !probe.hasPgVersion) {
        flashError('Selected folder is not an NFR Postgres data directory.');
        return;
      }
      setDialog({ kind: 'add', mode, path, existing: probe.hasPgVersion });
    } catch (err) {
      flashError(`Probe failed: ${String(err)}`);
    }
  };

  const onCreateClick = async () => {
    const bridge = window.__nfr__;
    if (bridge?.pickFolder) {
      const r = await bridge.pickFolder();
      if (r.canceled || !r.path) return;
      probeAndDialog(r.path, 'create');
    } else {
      setManualMode('create');
    }
  };

  const onConnectClick = async () => {
    const bridge = window.__nfr__;
    if (bridge?.pickFolder) {
      const r = await bridge.pickFolder();
      if (r.canceled || !r.path) return;
      probeAndDialog(r.path, 'connect');
    } else {
      setManualMode('connect');
    }
  };

  const onSubmitManual = () => {
    const path = manualPath.trim();
    if (!path || !manualMode) return;
    setManualPath('');
    const mode = manualMode;
    setManualMode(null);
    probeAndDialog(path, mode);
  };

  const confirmAdd = async () => {
    if (dialog.kind !== 'add') return;
    setBusy('add');
    try {
      const endpoint =
        dialog.mode === 'create' ? '/api/db/catalog/create' : '/api/db/catalog/connect';
      await apiPost(endpoint, { name: defaultNameFromPath(dialog.path), path: dialog.path });
      triggerRestart();
    } catch (err) {
      flashError(`Failed: ${String(err)}`);
      setBusy(null);
      setDialog({ kind: 'none' });
    }
  };

  const active = catalog?.entries.find((e) => e.path === catalog?.active) ?? null;
  const recents = (catalog?.entries ?? []).filter((e) => e.path !== catalog?.active);

  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">Storage</legend>

      {restarting && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-6 py-4 text-[11px] tracking-widest">
            RESTARTING…
          </div>
        </div>
      )}

      {/* Active database */}
      <div className="border border-[color:var(--color-border)] p-3 space-y-1">
        <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">ACTIVE DATABASE</div>
        {active ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px]">{active.name}</span>
              <span
                className={`text-[9px] tracking-widest px-1.5 py-0.5 border ${
                  active.reachable
                    ? 'border-emerald-700/60 text-emerald-300'
                    : 'border-red-700/60 text-red-300'
                }`}
              >
                {active.reachable ? 'REACHABLE' : 'UNREACHABLE'}
              </span>
            </div>
            <div className="text-[10px] text-[color:var(--color-text-mute)] break-all">{active.path}</div>
          </>
        ) : (
          <div className="text-[11px] text-[color:var(--color-text-faint)]">No active database.</div>
        )}
      </div>

      {/* Recent databases */}
      {recents.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">RECENT DATABASES</div>
          {recents.map((e) => (
            <div key={e.path} className="border border-[color:var(--color-border)] p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px]">{e.name}</span>
                <span className="text-[9px] text-[color:var(--color-text-faint)]">
                  {e.lastUsed ? relativeTime(e.lastUsed) : ''}
                </span>
              </div>
              <div className="text-[10px] text-[color:var(--color-text-mute)] break-all">{e.path}</div>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => onSwitch(e.path)}
                  disabled={busy !== null || !e.reachable}
                  className="px-2 py-1 border border-[color:var(--color-border)] text-[10px] tracking-widest disabled:opacity-40 hover:bg-[color:var(--color-bg)]"
                >
                  Switch
                </button>
                <button
                  onClick={() => onRemove(e.path)}
                  disabled={busy !== null}
                  className="px-2 py-1 border border-[color:var(--color-border)] text-[10px] tracking-widest disabled:opacity-40 hover:bg-[color:var(--color-bg)]"
                >
                  Remove
                </button>
                <button
                  onClick={() => setDialog({ kind: 'delete', entry: e })}
                  disabled={busy !== null}
                  className="px-2 py-1 border border-red-700/50 text-red-200 text-[10px] tracking-widest disabled:opacity-40 hover:bg-red-700/30"
                >
                  Delete files…
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap gap-2 pt-2">
        <button
          onClick={onCreateClick}
          disabled={busy !== null}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          + CREATE NEW…
        </button>
        <button
          onClick={onConnectClick}
          disabled={busy !== null}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          ↗ CONNECT EXISTING…
        </button>
      </div>

      {manualMode && (
        <div className="border border-[color:var(--color-border)] p-3 space-y-2">
          <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
            {manualMode === 'create' ? 'CREATE NEW (DEV)' : 'CONNECT EXISTING (DEV)'}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/absolute/path/to/folder"
              className="flex-1 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] px-2 py-1 text-[11px]"
            />
            <button
              onClick={onSubmitManual}
              disabled={!manualPath.trim()}
              className="px-2 py-1 border border-[color:var(--color-border)] text-[10px] tracking-widest disabled:opacity-40"
            >
              SUBMIT
            </button>
            <button
              onClick={() => {
                setManualMode(null);
                setManualPath('');
              }}
              className="px-2 py-1 border border-[color:var(--color-border)] text-[10px] tracking-widest"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-[11px] text-red-300 border border-red-700/50 px-3 py-2">{error}</div>
      )}

      {/* Delete confirmation modal */}
      {dialog.kind === 'delete' && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] p-6 max-w-md w-full space-y-3 font-mono text-[color:var(--color-text)]">
            <div className="text-[11px] tracking-widest uppercase">Delete database files?</div>
            <p className="text-[11px] text-[color:var(--color-text-mute)]">
              This will permanently erase all files at:
            </p>
            <pre className="text-[10px] text-[color:var(--color-text-faint)] break-all whitespace-pre-wrap">
              {dialog.entry.path}
            </pre>
            <p className="text-[11px] text-red-300">This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDialog({ kind: 'none' })}
                disabled={busy !== null}
                className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest"
              >
                CANCEL
              </button>
              <button
                onClick={() => onDelete(dialog.entry.path)}
                disabled={busy !== null}
                className="px-3 py-1.5 bg-red-700/40 text-red-100 border border-red-700/60 text-[11px] tracking-widest disabled:opacity-50"
              >
                DELETE FILES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/connect confirmation modal */}
      {dialog.kind === 'add' && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] p-6 max-w-md w-full space-y-3 font-mono text-[color:var(--color-text)]">
            <div className="text-[11px] tracking-widest uppercase">
              {dialog.existing ? 'Connect to existing database?' : 'Create new database here?'}
            </div>
            <pre className="text-[10px] text-[color:var(--color-text-faint)] break-all whitespace-pre-wrap">
              {dialog.path}
            </pre>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDialog({ kind: 'none' })}
                disabled={busy !== null}
                className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest"
              >
                CANCEL
              </button>
              <button
                onClick={confirmAdd}
                disabled={busy !== null}
                className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
              >
                {dialog.existing ? 'CONNECT' : 'CREATE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </fieldset>
  );
}

function defaultNameFromPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
