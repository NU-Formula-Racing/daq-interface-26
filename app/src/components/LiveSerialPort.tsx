import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface SerialPort { path: string; label: string }
interface AppConfig { serialPort?: string | null }
interface LiveStatus {
  basestation: 'connected' | 'disconnected';
  port: string | null;
  rssi?: number | null;
  snr?: number | null;
}

export function LiveSerialPort() {
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [saved, setSaved] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const [scanning, setScanning] = useState(false);

  const refresh = async () => {
    setScanning(true);
    try {
      const [{ ports }, cfg, st] = await Promise.all([
        apiGet<{ ports: SerialPort[] }>('/api/serial/ports'),
        apiGet<AppConfig>('/api/config'),
        apiGet<LiveStatus>('/api/live/status').catch(() => null),
      ]);
      setPorts(ports);
      const cur = cfg.serialPort ?? '';
      setSaved(cur || null);
      setSelected((prev) => prev || cur || '');
      if (st) setStatus(st);
    } catch (e) {
      setError(`Failed to load: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  const onSave = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await apiPost('/api/config', { serialPort: selected || null });
      setSaved(selected || null);
      // Parser restart is fire-and-forget on the server; poll status briefly.
      setTimeout(refresh, 1500);
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const inList = selected && ports.some((p) => p.path === selected);
  const showUnknown = selected && !inList;

  const canSave = !busy && selected !== (saved ?? '');

  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)] uppercase">
        Live serial port
      </legend>
      <p className="text-[11px] text-[color:var(--color-text-mute)]">
        Pick the USB-serial device that streams live CAN frames. The other
        USB device on this machine (the storage / database one) is not this.
      </p>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy}
          className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[11px] text-[color:var(--color-text)] min-w-[280px] disabled:opacity-50"
        >
          <option value="">— none —</option>
          {ports.map((p) => (
            <option key={p.path} value={p.path}>{p.label} ({p.path})</option>
          ))}
          {showUnknown && (
            <option value={selected}>{selected} (not currently connected)</option>
          )}
        </select>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          style={{
            padding: '6px 14px',
            background: 'var(--color-panel)',
            border: '1px solid var(--color-border-strong)',
            color: 'var(--color-text)',
            fontFamily: 'inherit',
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
          }}
          title="Re-scan attached USB-serial devices"
        >
          {scanning ? 'Rescanning…' : 'Rescan'}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          style={{
            padding: '6px 14px',
            background: canSave ? 'var(--color-accent)' : 'var(--color-panel)',
            border: '1px solid ' + (canSave ? 'var(--color-accent)' : 'var(--color-border)'),
            color: canSave ? '#fff' : 'var(--color-text-mute)',
            fontFamily: 'inherit',
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.5,
          }}
          title={canSave ? 'Save the selected port' : 'No changes to save'}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="text-[11px] text-[color:var(--color-text-mute)]">
        Currently saved: <code>{saved ?? '(none)'}</code>
        {status && (
          <span className="ml-4">
            Live status:{' '}
            <strong
              className={status.basestation === 'connected' ? 'text-green-300' : 'text-red-300'}
            >
              {status.basestation}
            </strong>
            {status.port && <span> ({status.port})</span>}
            {typeof status.rssi === 'number' && (
              <span className="ml-3">
                RSSI: <code>{status.rssi}</code> dBm
              </span>
            )}
            {typeof status.snr === 'number' && (
              <span className="ml-2">
                SNR: <code>{status.snr.toFixed(1)}</code> dB
              </span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div className="text-[11px] text-red-300 border border-red-700/40 px-3 py-2">{error}</div>
      )}
    </fieldset>
  );
}
