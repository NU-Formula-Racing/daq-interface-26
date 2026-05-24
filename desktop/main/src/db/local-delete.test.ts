import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { deleteLocalSessionRows, estimateLocalBytes } from './local-delete.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const S = '77777777-7777-7777-7777-777777777777';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (7001, 'PDM', 'V_DEL_TEST') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT DO NOTHING`, [S]);
  for (let i = 0; i < 100; i++) {
    await pool.query(
      `INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES ($1, $2, $3, $4)`,
      [new Date(Date.now() + i * 1000).toISOString(), S, 7001, i],
    );
  }
});
afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [S]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [S]);
  await pool.end();
});

describe('deleteLocalSessionRows', () => {
  it('estimates and deletes rows, leaves session row marked local_deleted_at', async () => {
    const est = await estimateLocalBytes(pool, [S]);
    expect(est).toBeGreaterThan(0);
    await deleteLocalSessionRows(pool, [S]);
    const { rows: r } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [S]);
    expect(Number(r[0].n)).toBe(0);
    const { rows: s } = await pool.query(
      'SELECT local_deleted_at FROM sessions WHERE id = $1', [S]);
    expect(s[0].local_deleted_at).not.toBeNull();
  });
});
