import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { apiGet, apiPost } from '../api/client.ts';

interface BroadcastResponse {
  enabled: boolean;
  token: string | null;
  host: string;
  port: number;
  lanUrls: string[];
}

export function Broadcast() {
  const [state, setState] = useState<BroadcastResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const refresh = () => {
    apiGet<BroadcastResponse>('/api/broadcast')
      .then(setState)
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  // Render the QR whenever the URL changes.
  const primaryUrl = state?.enabled && state.lanUrls.length > 0 ? state.lanUrls[0] : null;
  useEffect(() => {
    if (!primaryUrl || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, primaryUrl, {
      width: 192,
      margin: 1,
      color: { dark: '#e6e6e6', light: '#00000000' },
    }).catch(() => {});
  }, [primaryUrl]);

  const triggerRestart = () => {
    setRestarting(true);
    setTimeout(() => window.location.reload(), 1500);
  };

  const flashError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(''), 6000);
  };

  const onToggle = async () => {
    if (!state || busy) return;
    setBusy(true);
    try {
      await apiPost('/api/broadcast/toggle', { enabled: !state.enabled });
      triggerRestart();
    } catch (err) {
      flashError(`Toggle failed: ${String(err)}`);
      setBusy(false);
    }
  };

  const onRegenerate = async () => {
    if (busy) return;
    if (!confirm('Regenerate the auth token? Existing peers will be disconnected.')) return;
    setBusy(true);
    try {
      await apiPost('/api/broadcast/regenerate-token', {});
      triggerRestart();
    } catch (err) {
      flashError(`Regenerate failed: ${String(err)}`);
      setBusy(false);
    }
  };

  const onCopyUrl = async () => {
    if (!primaryUrl) return;
    try {
      await navigator.clipboard.writeText(primaryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      flashError('Clipboard write failed.');
    }
  };

  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
        Broadcast on LAN
      </legend>

      {restarting && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
          <div className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-6 py-4 text-[11px] tracking-widest">
            RESTARTING…
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={state?.enabled ?? false}
          disabled={busy || state === null}
          onChange={onToggle}
          className="accent-[color:var(--color-accent)]"
        />
        <span className="text-[11px]">Enabled (requires server restart)</span>
      </label>

      <p className="text-[10px] text-[color:var(--color-text-mute)] leading-relaxed">
        When enabled, peers on this network can open the dashboard in any browser.
        The auth token is regenerated each time you turn this on.
      </p>

      {state?.enabled && (
        <div className="border border-[color:var(--color-border)] p-3 space-y-3">
          <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
            CONNECTION
          </div>

          {primaryUrl ? (
            <>
              <div className="text-[11px] break-all text-[color:var(--color-text)] font-mono">
                {primaryUrl}
              </div>

              {state.lanUrls.length > 1 && (
                <div className="space-y-0.5">
                  <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">
                    OTHER INTERFACES
                  </div>
                  {state.lanUrls.slice(1).map((u) => (
                    <div key={u} className="text-[10px] text-[color:var(--color-text-faint)] break-all">
                      {u}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-center py-2">
                <canvas ref={canvasRef} className="bg-transparent" />
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[color:var(--color-text-faint)]">
              No non-internal IPv4 addresses found on this machine.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onCopyUrl}
              disabled={busy || !primaryUrl}
              className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
            >
              {copied ? 'COPIED' : 'COPY URL'}
            </button>
            <button
              onClick={onRegenerate}
              disabled={busy}
              className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
            >
              REGENERATE TOKEN
            </button>
          </div>
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
