import type pg from 'pg';

export interface AppConfig extends Record<string, unknown> {
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
  // DigitalOcean Spaces (S3-compatible) credentials. All four must be set
  // for the cloud upload flow to be available.
  spacesEndpoint?: string | null;   // e.g. "https://nyc3.digitaloceanspaces.com"
  spacesRegion?: string | null;     // e.g. "us-east-1" (DO ignores but SDK requires)
  spacesBucket?: string | null;
  spacesAccessKey?: string | null;
  spacesSecretKey?: string | null;
  /** When true, the desktop streams parser frames into Supabase rt_readings
   *  in best-effort batches as a live-feed mirror. Supabase truncates the
   *  table nightly so this is a "cool factor" view, not a durable copy. */
  cloudLiveEnabled?: boolean | null;
}

export async function getAppConfig(pool: pg.Pool): Promise<AppConfig> {
  const { rows } = await pool.query<{ data: AppConfig }>(
    'SELECT data FROM app_config WHERE id = 1'
  );
  return rows[0]?.data ?? {};
}

export async function setAppConfig(
  pool: pg.Pool,
  patch: AppConfig
): Promise<void> {
  await pool.query(
    'UPDATE app_config SET data = data || $1::jsonb, updated_at = now() WHERE id = 1',
    [JSON.stringify(patch)]
  );
}
