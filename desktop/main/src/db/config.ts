import type pg from 'pg';

export type AppConfig = Record<string, unknown>;

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
