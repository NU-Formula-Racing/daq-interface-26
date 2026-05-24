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

  const refresh = async () => {
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

  return (
    <section style={{ padding: '12px 0', borderTop: '1px solid #222' }}>
      <h3 style={{ margin: '0 0 8px 0' }}>Live serial port</h3>
      <p style={{ margin: '0 0 12px 0', color: '#999', fontSize: 13 }}>
        Pick the USB-serial device that streams live CAN frames. The other
        USB device on this machine (the storage / database one) is not this.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy}
          style={{ minWidth: 280 }}
        >
          <option value="">— none —</option>
          {ports.map((p) => (
            <option key={p.path} value={p.path}>{p.label} ({p.path})</option>
          ))}
          {showUnknown && (
            <option value={selected}>{selected} (not currently connected)</option>
          )}
        </select>
        <button onClick={refresh} disabled={busy}>Rescan</button>
        <button onClick={onSave} disabled={busy || selected === (saved ?? '')}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 13, color: '#bbb' }}>
        Currently saved: <code>{saved ?? '(none)'}</code>
        {status && (
          <span style={{ marginLeft: 16 }}>
            Live status: <strong
              style={{ color: status.basestation === 'connected' ? '#7c7' : '#c77' }}>
              {status.basestation}
            </strong>
            {status.port && <span> ({status.port})</span>}
            {typeof status.rssi === 'number' && (
              <span style={{ marginLeft: 12 }}>
                RSSI: <code>{status.rssi}</code> dBm
              </span>
            )}
            {typeof status.snr === 'number' && (
              <span style={{ marginLeft: 8 }}>
                SNR: <code>{status.snr.toFixed(1)}</code> dB
              </span>
            )}
          </span>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 8, color: '#f88', fontSize: 13 }}>{error}</div>
      )}
    </section>
  );
}
