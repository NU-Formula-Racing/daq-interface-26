import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface NfrBridge {
  baseUrl?: string;
  pickFolder?: () => Promise<{ canceled: boolean; path: string | null }>;
  userDataPath?: () => Promise<string>;
}

declare global {
  interface Window {
    __nfr__?: NfrBridge;
  }
}

interface CatalogResponse {
  active: string | null;
  entries: Array<{ name: string; path: string; lastUsed?: string; reachable: boolean }>;
}

interface ProbeResponse {
  exists: boolean;
  hasPgVersion: boolean;
}

export default function StorageSetup() {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [restarting, setRestarting] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [pendingExisting, setPendingExisting] = useState<boolean>(false);
  const [manualPath, setManualPath] = useState<string>('');

  useEffect(() => {
    apiGet<CatalogResponse>('/api/db/catalog').catch(() => {});
  }, []);

  const triggerRestart = () => {
    setRestarting(true);
    setStatus('Restarting…');
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  };

  const useDefault = async () => {
    setBusy('default');
    setStatus('Initializing default location…');
    try {
      const bridge = window.__nfr__;
      let userData: string | null = null;
      if (bridge?.userDataPath) {
        userData = await bridge.userDataPath();
      }
      if (!userData) {
        // Browser dev mode fallback — let server pick a sane path.
        userData = '~/.nfr-local';
      }
      const path = userData.endsWith('/') ? `${userData}db` : `${userData}/db`;
      await apiPost('/api/db/catalog/create', { name: 'Default', path });
      triggerRestart();
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
      setBusy(null);
    }
  };

  const decidePath = async (path: string) => {
    setBusy('probe');
    setStatus('Inspecting folder…');
    try {
      const probe = await apiGet<ProbeResponse>('/api/db/probe', { path });
      setPendingPath(path);
      setPendingExisting(probe.hasPgVersion);
      setStatus('');
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const chooseFolder = async () => {
    const bridge = window.__nfr__;
    if (!bridge?.pickFolder) {
      setStatus('Folder picker only available in the desktop app. Use the text field below.');
      return;
    }
    const res = await bridge.pickFolder();
    if (res.canceled || !res.path) return;
    await decidePath(res.path);
  };

  const submitManual = async () => {
    if (!manualPath.trim()) return;
    await decidePath(manualPath.trim());
  };

  const confirmCreate = async () => {
    if (!pendingPath) return;
    setBusy('create');
    setStatus('Creating new database…');
    try {
      await apiPost('/api/db/catalog/create', {
        name: defaultNameFromPath(pendingPath),
        path: pendingPath,
      });
      triggerRestart();
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
      setBusy(null);
    }
  };

  const confirmConnect = async () => {
    if (!pendingPath) return;
    setBusy('connect');
    setStatus('Connecting to database…');
    try {
      await apiPost('/api/db/catalog/connect', {
        name: defaultNameFromPath(pendingPath),
        path: pendingPath,
      });
      triggerRestart();
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
      setBusy(null);
    }
  };

  const cancelPending = () => {
    setPendingPath(null);
    setPendingExisting(false);
  };

  const hasPicker = typeof window !== 'undefined' && !!window.__nfr__?.pickFolder;

  return (
    <div className="h-full flex items-center justify-center p-8 font-mono text-[color:var(--color-text)]">
      <div className="max-w-xl w-full border border-[color:var(--color-border)] bg-[color:var(--color-panel)] p-8 space-y-6">
        <h1 className="text-lg tracking-widest uppercase">Choose where to store your data</h1>
        <p className="text-xs text-[color:var(--color-text-mute)] leading-relaxed">
          nfrInterface needs a place to keep your sessions and signals. You can use
          the default location or pick a folder (e.g. on an external drive).
        </p>

        {restarting && (
          <div className="text-[11px] text-[color:var(--color-text-mute)] border border-[color:var(--color-border)] px-3 py-2">
            Restarting…
          </div>
        )}

        {!pendingPath && !restarting && (
          <div className="space-y-3">
            <button
              onClick={useDefault}
              disabled={busy !== null}
              className="w-full px-4 py-3 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
            >
              {busy === 'default' ? 'WORKING…' : 'USE DEFAULT LOCATION'}
            </button>

            {hasPicker ? (
              <button
                onClick={chooseFolder}
                disabled={busy !== null}
                className="w-full px-4 py-3 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
              >
                CHOOSE A FOLDER…
              </button>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
                  CHOOSE A FOLDER (dev mode — type an absolute path)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualPath}
                    onChange={(e) => setManualPath(e.target.value)}
                    placeholder="/absolute/path/to/folder"
                    className="flex-1 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] px-2 py-1.5 text-[11px]"
                  />
                  <button
                    onClick={submitManual}
                    disabled={busy !== null || !manualPath.trim()}
                    className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50"
                  >
                    SUBMIT
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {pendingPath && !restarting && (
          <div className="space-y-3 border border-[color:var(--color-border)] p-4">
            <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">SELECTED FOLDER</div>
            <div className="text-[11px] break-all">{pendingPath}</div>
            {pendingExisting ? (
              <>
                <p className="text-[11px] text-[color:var(--color-text-mute)]">
                  Existing NFR database detected — Connect?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmConnect}
                    disabled={busy !== null}
                    className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
                  >
                    {busy === 'connect' ? 'CONNECTING…' : 'CONNECT'}
                  </button>
                  <button
                    onClick={cancelPending}
                    disabled={busy !== null}
                    className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest"
                  >
                    CANCEL
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[11px] text-[color:var(--color-text-mute)]">
                  Create new database in this folder?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmCreate}
                    disabled={busy !== null}
                    className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
                  >
                    {busy === 'create' ? 'CREATING…' : 'CREATE'}
                  </button>
                  <button
                    onClick={cancelPending}
                    disabled={busy !== null}
                    className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest"
                  >
                    CANCEL
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {status && !restarting && (
          <div className="text-[11px] text-[color:var(--color-text-mute)]">{status}</div>
        )}
      </div>
    </div>
  );
}

function defaultNameFromPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}
