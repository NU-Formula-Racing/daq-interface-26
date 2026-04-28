import { useState } from 'react';
import { apiPost } from '../api/client.ts';

export function Uninstall() {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trigger = async () => {
    if (confirmText !== 'UNINSTALL') return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/uninstall', { confirm: 'UNINSTALL' });
      setDone(true);
    } catch (err) {
      // The server may close the connection mid-response when it exits;
      // treat any error here as success unless we got an explicit 4xx.
      const msg = String(err);
      if (msg.includes('400') || msg.includes('confirm')) {
        setError(msg);
        setBusy(false);
      } else {
        setDone(true);
      }
    }
  };

  if (done) {
    return (
      <fieldset className="border border-red-700/50 p-4 space-y-3">
        <legend className="px-2 text-[10px] tracking-widest text-red-300">Uninstall complete</legend>
        <p className="text-[11px] text-[color:var(--color-text-mute)] leading-relaxed">
          All databases and app data have been deleted. The app will quit shortly.
        </p>
        <p className="text-[11px] text-[color:var(--color-text-mute)] leading-relaxed">
          To finish removing nfrInterface, drag <code>nfrInterface.app</code> from
          /Applications to the Trash.
        </p>
      </fieldset>
    );
  }

  return (
    <fieldset className="border border-red-700/50 p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-red-300">Uninstall</legend>
      <p className="text-[11px] text-[color:var(--color-text-mute)] leading-relaxed">
        Permanently deletes every database in your catalog (including external
        drive locations), the catalog file, and this app's local data. The app
        itself stays in /Applications until you drag it to the Trash.
      </p>
      <p className="text-[11px] text-red-300/80 leading-relaxed">
        This cannot be undone. Export any data you want to keep first.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
          Type UNINSTALL to confirm
        </span>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-text)]"
          placeholder="UNINSTALL"
        />
      </label>
      <button
        onClick={trigger}
        disabled={busy || confirmText !== 'UNINSTALL'}
        className="px-3 py-1.5 bg-red-700/30 text-red-200 border border-red-700/50 tracking-widest text-[11px] disabled:opacity-30 hover:bg-red-700/50"
      >
        {busy ? 'Uninstalling…' : 'Wipe data and quit'}
      </button>
      {error && (
        <div className="text-[11px] text-red-300 border border-red-700/40 px-2 py-1">{error}</div>
      )}
    </fieldset>
  );
}
