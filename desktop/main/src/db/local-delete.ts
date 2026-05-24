import type pg from 'pg';

export async function estimateLocalBytes(pool: pg.Pool, sessionIds: string[]): Promise<number> {
  if (sessionIds.length === 0) return 0;
  // Rough estimate: 32 bytes per row (timestamptz + smallint + double + tuple overhead).
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = ANY($1)`,
    [sessionIds],
  );
  return Number(rows[0].n) * 32;
}

export async function deleteLocalSessionRows(pool: pg.Pool, sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await pool.query('DELETE FROM sd_readings WHERE session_id = ANY($1)', [sessionIds]);
  await pool.query(
    `UPDATE sessions SET local_deleted_at = now() WHERE id = ANY($1)`,
    [sessionIds],
  );
  // VACUUM cannot run in a transaction; pg pool auto-commits between queries.
  await pool.query('VACUUM sd_readings');
}
