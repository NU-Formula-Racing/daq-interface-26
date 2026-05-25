import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface CloudStatus {
  supabaseUrl: string | null;
  hasSupabaseAnonKey: boolean;
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  hasSpacesAccessKey: boolean;
  hasSpacesSecretKey: boolean;
  spacesConfigured: boolean;
  supabaseConfigured: boolean;
  cloudLiveEnabled: boolean;
}

const PLACEHOLDER_SET = '••••• (set)';

/** Single panel covering both halves of the cloud config:
 *  - Supabase metastore (sessions/signal_definitions/session_blobs).
 *  - DigitalOcean Spaces bucket holding the Parquet bulk data.
 *  Both are required for the new upload + pull + live-stream flows. */
export function CloudConfig() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [spacesEndpoint, setSpacesEndpoint] = useState('');
  const [spacesRegion, setSpacesRegion] = useState('');
  const [spacesBucket, setSpacesBucket] = useState('');
  const [spacesAccessKey, setSpacesAccessKey] = useState('');
  const [spacesSecretKey, setSpacesSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const refresh = () => {
    apiGet<CloudStatus>('/api/cloud/status').then(setStatus).catch(() => setStatus(null));
  };
  useEffect(() => { refresh(); }, []);

  const flashError = (msg: string) => { setInfo(''); setError(msg); setTimeout(() => setError(''), 8000); };
  const flashInfo  = (msg: string) => { setError(''); setInfo(msg);  setTimeout(() => setInfo(''),  6000); };

  const onSave = async () => {
    setBusy(true);
    try {
      const patch: Record<string, string> = {};
      if (supabaseUrl)     patch.supabaseUrl     = supabaseUrl.trim();
      if (supabaseAnonKey) patch.supabaseAnonKey = supabaseAnonKey.trim();
      if (spacesEndpoint)  patch.spacesEndpoint  = spacesEndpoint.trim();
      if (spacesRegion)    patch.spacesRegion    = spacesRegion.trim();
      if (spacesBucket)    patch.spacesBucket    = spacesBucket.trim();
      if (spacesAccessKey) patch.spacesAccessKey = spacesAccessKey.trim();
      if (spacesSecretKey) patch.spacesSecretKey = spacesSecretKey.trim();
      await apiPost('/api/cloud/config', patch);
      // Never echo secrets back to the user
      setSupabaseAnonKey('');
      setSpacesAccessKey('');
      setSpacesSecretKey('');
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
        Cloud config
      </legend>

      <div className="text-[10px] text-[color:var(--color-text-mute)] leading-relaxed">
        Two providers, one form: Supabase holds session metadata, DO Spaces
        holds the Parquet bulk data. Both are needed for the Upload All and
        Pull flows. Credentials are stored locally in the app config — they
        never appear in API responses or logs.
      </div>

      {/* Supabase */}
      <div className="space-y-2 border-t border-[color:var(--color-border)]/60 pt-3">
        <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">SUPABASE (METASTORE)</div>
        <Field
          label="SUPABASE URL"
          value={supabaseUrl} setValue={setSupabaseUrl}
          placeholder={status?.supabaseUrl ?? 'https://xxx.supabase.co'}
        />
        <Field
          label="SUPABASE ANON KEY"
          value={supabaseAnonKey} setValue={setSupabaseAnonKey} secret
          placeholder={status?.hasSupabaseAnonKey ? PLACEHOLDER_SET : 'eyJ…'}
        />
      </div>

      {/* DO Spaces */}
      <div className="space-y-2 border-t border-[color:var(--color-border)]/60 pt-3">
        <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">DIGITALOCEAN SPACES (BULK STORE)</div>
        <Field
          label="ENDPOINT URL"
          value={spacesEndpoint} setValue={setSpacesEndpoint}
          placeholder={status?.spacesEndpoint ?? 'https://nyc3.digitaloceanspaces.com'}
        />
        <Field
          label="REGION SLUG"
          value={spacesRegion} setValue={setSpacesRegion}
          placeholder={status?.spacesRegion ?? 'nyc3'}
        />
        <Field
          label="BUCKET NAME"
          value={spacesBucket} setValue={setSpacesBucket}
          placeholder={status?.spacesBucket ?? 'nfr26-sessions'}
        />
        <Field
          label="ACCESS KEY ID"
          value={spacesAccessKey} setValue={setSpacesAccessKey} secret
          placeholder={status?.hasSpacesAccessKey ? PLACEHOLDER_SET : 'DO00…'}
        />
        <Field
          label="SECRET ACCESS KEY"
          value={spacesSecretKey} setValue={setSpacesSecretKey} secret
          placeholder={status?.hasSpacesSecretKey ? PLACEHOLDER_SET : '••••••••'}
        />
      </div>

      <label className="flex items-center gap-2 text-[11px] cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={status?.cloudLiveEnabled ?? false}
          onChange={async (e) => {
            try {
              await apiPost('/api/cloud/config', { cloudLiveEnabled: e.target.checked });
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
          SUPABASE: {status?.supabaseConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'} ·{' '}
          SPACES: {status?.spacesConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'}
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
