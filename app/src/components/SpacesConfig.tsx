import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface SpacesStatus {
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  configured: boolean;
  cloudLiveEnabled: boolean;
}

const PLACEHOLDER_SET = '••••• (set)';

/** Credentials panel for the DigitalOcean Spaces bucket that holds the
 *  Parquet bulk data. Cosmetically mirrors <CloudSync /> so they read as
 *  siblings on the Settings page. */
export function SpacesConfig() {
  const [status, setStatus] = useState<SpacesStatus | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const refresh = () => {
    apiGet<SpacesStatus>('/api/spaces/status').then(setStatus).catch(() => setStatus(null));
  };
  useEffect(() => { refresh(); }, []);

  const flashError = (msg: string) => { setInfo(''); setError(msg); setTimeout(() => setError(''), 8000); };
  const flashInfo  = (msg: string) => { setError(''); setInfo(msg);  setTimeout(() => setInfo(''),  6000); };

  const onSave = async () => {
    setBusy(true);
    try {
      const patch: Record<string, string> = {};
      if (endpoint)  patch.spacesEndpoint  = endpoint.trim();
      if (region)    patch.spacesRegion    = region.trim();
      if (bucket)    patch.spacesBucket    = bucket.trim();
      if (accessKey) patch.spacesAccessKey = accessKey.trim();
      if (secretKey) patch.spacesSecretKey = secretKey.trim();
      await apiPost('/api/spaces/config', patch);
      setAccessKey(''); setSecretKey('');  // never echo secrets back
      flashInfo('Saved.');
      refresh();
    } catch (e) {
      flashError(`Save failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="border border-[color:var(--color-border)] p-4 space-y-3">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
        Spaces (bulk parquet storage)
      </legend>

      <div className="text-[10px] text-[color:var(--color-text-mute)] leading-relaxed">
        DigitalOcean Spaces bucket where session Parquet files live. Catalog
        rows still go to Supabase; bytes go here. Credentials below are
        stored locally in the app config — they never appear in API
        responses or logs.
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Stat label="ENDPOINT" value={status?.endpoint ?? '—'} />
        <Stat label="REGION"   value={status?.region   ?? '—'} />
        <Stat label="BUCKET"   value={status?.bucket   ?? '—'} />
      </div>

      <div className="space-y-2">
        <Field label="ENDPOINT URL"
          value={endpoint} setValue={setEndpoint}
          placeholder={status?.endpoint ?? 'https://nyc3.digitaloceanspaces.com'}
        />
        <Field label="REGION SLUG"
          value={region} setValue={setRegion}
          placeholder={status?.region ?? 'nyc3'}
        />
        <Field label="BUCKET NAME"
          value={bucket} setValue={setBucket}
          placeholder={status?.bucket ?? 'nfr26-sessions'}
        />
        <Field label="ACCESS KEY ID"
          value={accessKey} setValue={setAccessKey} secret
          placeholder={status?.hasAccessKey ? PLACEHOLDER_SET : 'DO00…'}
        />
        <Field label="SECRET ACCESS KEY"
          value={secretKey} setValue={setSecretKey} secret
          placeholder={status?.hasSecretKey ? PLACEHOLDER_SET : '••••••••'}
        />
      </div>

      <label className="flex items-center gap-2 text-[11px] cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={status?.cloudLiveEnabled ?? false}
          onChange={async (e) => {
            try {
              await apiPost('/api/spaces/config', { cloudLiveEnabled: e.target.checked });
              flashInfo(e.target.checked ? 'Live cloud stream enabled.' : 'Live cloud stream disabled.');
              refresh();
            } catch (err) { flashError(`Toggle failed: ${String(err)}`); }
          }}
          className="accent-[color:var(--color-accent)]"
        />
        <span>
          Stream live frames to Supabase <code>rt_readings</code> (truncated nightly).
          Takes effect on next desktop launch.
        </span>
      </label>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={busy}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] self-center">
          STATUS: {status?.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}
        </span>
      </div>

      {info && (
        <div className="text-[11px] text-[color:var(--color-text)] border border-[color:var(--color-border)] px-3 py-2">{info}</div>
      )}
      {error && (
        <div className="text-[11px] text-red-300 border border-red-700/50 px-3 py-2">{error}</div>
      )}
    </fieldset>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[color:var(--color-border)] px-3 py-2">
      <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">{label}</div>
      <div className="text-[11px] font-mono truncate" title={value}>{value}</div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <label className="block text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
      {props.label}
      <input
        type={props.secret ? 'password' : 'text'}
        value={props.value}
        onChange={(e) => props.setValue(e.target.value)}
        placeholder={props.placeholder}
        autoComplete="off"
        className="mt-1 w-full bg-transparent border border-[color:var(--color-border)] px-2 py-1 text-[11px] font-mono"
      />
    </label>
  );
}
