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
  defaults: {
    supabaseUrl: string | null;
    hasSupabaseAnonKey: boolean;
    spacesPublicBase: string | null;
  };
  spacesWriteReady: boolean;
  supabaseReadReady: boolean;
  spacesReadReady: boolean;
  cloudLiveEnabled: boolean;
}

const PLACEHOLDER_SET = '••••• (set)';

export function CloudConfig() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [spacesEndpoint, setSpacesEndpoint] = useState('');
  const [spacesRegion, setSpacesRegion] = useState('');
  const [spacesBucket, setSpacesBucket] = useState('');
  const [spacesAccessKey, setSpacesAccessKey] = useState('');
  const [spacesSecretKey, setSpacesSecretKey] = useState('');
  const [showWriteInputs, setShowWriteInputs] = useState(false);
  const [showSupabaseOverride, setShowSupabaseOverride] = useState(false);
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

      {/* Default cloud (read-only display) */}
      <div className="space-y-2">
        <div className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">
          DEFAULT CLOUD (READ-ONLY)
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="border border-[color:var(--color-border)]/60 px-2 py-1">
            <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">SUPABASE</div>
            <div className="truncate" title={status?.defaults.supabaseUrl ?? ''}>
              {status?.defaults.supabaseUrl ?? '—'}
            </div>
          </div>
          <div className="border border-[color:var(--color-border)]/60 px-2 py-1">
            <div className="text-[9px] tracking-widest text-[color:var(--color-text-mute)]">SPACES (PUBLIC URL)</div>
            <div className="truncate" title={status?.defaults.spacesPublicBase ?? ''}>
              {status?.defaults.spacesPublicBase ?? '—'}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-[color:var(--color-text-mute)]">
          Reads work out of the box. The Cloud tab in Storage and the
          per-session pull flow will use these unless you override below.
        </div>
      </div>

      {/* Supabase override — collapsed by default */}
      <div className="border-t border-[color:var(--color-border)]/60 pt-3">
        <button
          onClick={() => setShowSupabaseOverride((v) => !v)}
          className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]"
        >
          {showSupabaseOverride ? '▾' : '▸'} OVERRIDE SUPABASE (ADVANCED)
        </button>
        {showSupabaseOverride && (
          <div className="space-y-2 mt-2">
            <Field label="SUPABASE URL"
              value={supabaseUrl} setValue={setSupabaseUrl}
              placeholder={status?.supabaseUrl ?? 'https://xxx.supabase.co'} />
            <Field label="SUPABASE ANON KEY"
              value={supabaseAnonKey} setValue={setSupabaseAnonKey} secret
              placeholder={status?.hasSupabaseAnonKey ? PLACEHOLDER_SET : 'eyJ…'} />
          </div>
        )}
      </div>

      {/* Spaces write credentials — collapsed by default */}
      <div className="border-t border-[color:var(--color-border)]/60 pt-3">
        <button
          onClick={() => setShowWriteInputs((v) => !v)}
          className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]"
        >
          {showWriteInputs ? '▾' : '▸'} WRITE CREDENTIALS (FOR UPLOADING)
        </button>
        {showWriteInputs && (
          <div className="space-y-2 mt-2">
            <Field label="ENDPOINT URL"
              value={spacesEndpoint} setValue={setSpacesEndpoint}
              placeholder={status?.spacesEndpoint ?? 'https://nyc3.digitaloceanspaces.com'} />
            <Field label="REGION SLUG"
              value={spacesRegion} setValue={setSpacesRegion}
              placeholder={status?.spacesRegion ?? 'nyc3'} />
            <Field label="BUCKET NAME"
              value={spacesBucket} setValue={setSpacesBucket}
              placeholder={status?.spacesBucket ?? 'nfr26-sessions'} />
            <Field label="ACCESS KEY ID"
              value={spacesAccessKey} setValue={setSpacesAccessKey} secret
              placeholder={status?.hasSpacesAccessKey ? PLACEHOLDER_SET : 'DO00…'} />
            <Field label="SECRET ACCESS KEY"
              value={spacesSecretKey} setValue={setSpacesSecretKey} secret
              placeholder={status?.hasSpacesSecretKey ? PLACEHOLDER_SET : '••••••••'} />
          </div>
        )}
      </div>

      {/* Live cloud sync toggle. Disabled unless the user has supplied their
          OWN Supabase URL + anon key — the bundled defaults are read-only
          credentials shared across all installs, and writing live data with
          them would let anyone with the app push frames to the team project.
          Each recording machine should authenticate with its own write key. */}
      {(() => {
        const hasUserCreds = !!(status?.supabaseUrl && status?.hasSupabaseAnonKey);
        return (
          <div className="pt-1 space-y-1">
            <label className={`flex items-center gap-2 text-[11px] ${hasUserCreds ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
              <input
                type="checkbox"
                disabled={!hasUserCreds}
                checked={status?.cloudLiveEnabled ?? false}
                onChange={async (e) => {
                  const next = e.target.checked;
                  try {
                    await apiPost('/api/cloud/config', { cloudLiveEnabled: next });
                    flashInfo(next ? 'Live cloud sync enabled.' : 'Live cloud sync disabled.');
                    refresh();
                  } catch (err) { flashError(`Toggle failed: ${String(err)}`); }
                }}
                className="accent-[color:var(--color-accent)]"
              />
              <span>
                Stream live frames to Supabase <code>live_readings</code> (12 h rolling retention).
                Takes effect on next desktop launch.
              </span>
            </label>
            {!hasUserCreds && (
              <div className="text-[10px] text-[color:var(--color-text-mute)] pl-6">
                Requires your own Supabase URL + anon key — expand <strong>OVERRIDE SUPABASE
                (ADVANCED)</strong> above and save them first. The bundled defaults are
                read-only and shared across all installs; only the recording
                machine should be writing.
              </div>
            )}
          </div>
        );
      })()}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={busy}
          className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)] self-center">
          READ: {status?.supabaseReadReady && status?.spacesReadReady ? 'READY' : 'NOT READY'} ·{' '}
          WRITE: {status?.spacesWriteReady ? 'READY' : 'NOT READY'}
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
