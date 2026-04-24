import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

type Config = {
  serialPort?: string;
  watchDir?: string;
  replayFile?: string;
  replaySpeed?: number;
  broadcastEnabled?: boolean;
  density?: 'compact' | 'comfortable';
  graphStyle?: 'line' | 'area' | 'step';
  accent?: string;
};

export default function Settings() {
  const [cfg, setCfg] = useState<Config>({});
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    apiGet<Config>('/api/config').then(setCfg).catch(() => setCfg({}));
  }, []);

  const update = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));

  const save = async () => {
    setStatus('Saving…');
    try {
      await apiPost('/api/config', cfg);
      setStatus('Saved. Server restart required for parser-affecting changes.');
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    }
    setTimeout(() => setStatus(''), 5000);
  };

  return (
    <div className="p-8 overflow-auto h-full font-mono text-xs text-[color:var(--color-text)]">
      <div className="max-w-xl space-y-6">
        <Section title="CAPTURE">
          <Field label="Serial port" value={cfg.serialPort ?? ''} onChange={(v) => update({ serialPort: v })} />
          <Field label="SD watch directory" value={cfg.watchDir ?? ''} onChange={(v) => update({ watchDir: v })} />
        </Section>

        <Section title="REPLAY (HARDWARE-FREE TESTING)">
          <Field label="Replay file (.nfr)" value={cfg.replayFile ?? ''} onChange={(v) => update({ replayFile: v })} />
          <Field
            label="Replay speed (0 = flood)"
            value={String(cfg.replaySpeed ?? '')}
            onChange={(v) => update({ replaySpeed: v === '' ? undefined : Number(v) })}
          />
        </Section>

        <Section title="BROADCAST ON LAN">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!cfg.broadcastEnabled}
              onChange={(e) => update({ broadcastEnabled: e.target.checked })}
            />
            <span>Enabled (requires server restart)</span>
          </label>
        </Section>

        <Section title="APPEARANCE">
          <Field label="Accent (hex)" value={cfg.accent ?? '#4E2A84'} onChange={(v) => update({ accent: v })} />
          <Select
            label="Density"
            value={cfg.density ?? 'compact'}
            options={['compact', 'comfortable']}
            onChange={(v) => update({ density: v as Config['density'] })}
          />
          <Select
            label="Graph style"
            value={cfg.graphStyle ?? 'line'}
            options={['line', 'area', 'step']}
            onChange={(v) => update({ graphStyle: v as Config['graphStyle'] })}
          />
        </Section>

        <div className="flex gap-2 items-center">
          <button
            onClick={save}
            className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white tracking-widest text-[11px]"
          >
            SAVE
          </button>
          <span className="text-[color:var(--color-text-mute)]">{status}</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border border-[color:var(--color-border)] p-4">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{title}</legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-text)]"
      />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-text)]"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
