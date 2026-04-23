import type pg from 'pg';

export interface Session {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
  source: 'live' | 'sd_import';
  source_file: string | null;
  synced_at: string | null;
}

export interface SessionDetail extends Session {
  signals: Array<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>;
}

export interface OverviewRow {
  bucket: string;
  signal_id: number;
  avg_value: number;
}

export async function listSessions(pool: pg.Pool): Promise<Session[]> {
  const { rows } = await pool.query<Session>(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, synced_at
     FROM sessions
     ORDER BY started_at DESC`
  );
  return rows;
}

export async function getSession(
  pool: pg.Pool,
  id: string
): Promise<SessionDetail | null> {
  const { rows } = await pool.query<Session>(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, synced_at
     FROM sessions WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return null;

  const sigs = await pool.query<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>(
    `SELECT signal_id, source, signal_name, unit FROM get_session_signals($1)`,
    [id]
  );
  return { ...rows[0], signals: sigs.rows };
}

export type SessionPatch = Partial<
  Pick<Session, 'track' | 'driver' | 'car' | 'notes'>
>;

export async function updateSession(
  pool: pg.Pool,
  id: string,
  patch: SessionPatch
): Promise<void> {
  const fields = (['track', 'driver', 'car', 'notes'] as const).filter(
    (k) => k in patch
  );
  if (fields.length === 0) return;

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map((f) => patch[f] ?? null);
  await pool.query(
    `UPDATE sessions SET ${sets} WHERE id = $1`,
    [id, ...values]
  );
}

export async function deleteSession(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function getSessionOverview(
  pool: pg.Pool,
  id: string,
  bucketSecs: number
): Promise<OverviewRow[]> {
  const { rows } = await pool.query<{
    bucket: Date;
    signal_id: number;
    avg_value: string;
  }>(
    `SELECT bucket, signal_id, avg_value FROM get_session_overview($1, $2) ORDER BY bucket, signal_id`,
    [id, bucketSecs]
  );
  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    signal_id: r.signal_id,
    avg_value: Number(r.avg_value),
  }));
}
