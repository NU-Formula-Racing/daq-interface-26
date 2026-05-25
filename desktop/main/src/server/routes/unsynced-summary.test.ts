import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fastify from 'fastify';
import { Pool } from 'pg';
import { registerUnsyncedSummaryRoutes } from './unsynced-summary.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const A = '55555555-0000-0000-0000-00000000000a';
const B = '55555555-0000-0000-0000-00000000000b';
const C = '55555555-0000-0000-0000-00000000000c';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (500, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  for (const id of [A, B, C]) {
    await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
      ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'sd_import')
      ON CONFLICT (id) DO NOTHING`, [id]);
  }
  // A: 3 readings, unsynced. B: 1 reading, synced. C: 0 readings, unsynced.
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 500, 1.0),
    ('2026-05-24T00:00:02Z', $1, 500, 2.0),
    ('2026-05-24T00:00:03Z', $1, 500, 3.0),
    ('2026-05-24T00:00:01Z', $2, 500, 9.0)`, [A, B]);
  await pool.query(`UPDATE sessions SET synced_at = now() WHERE id = $1`, [B]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = ANY($1)', [[A, B, C]]);
  await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[A, B, C]]);
  await pool.end();
});

describe('GET /api/cloud/unsynced-summary', () => {
  it('returns count, approxBytes, and sessionIds for unsynced sessions only', async () => {
    const app = fastify();
    registerUnsyncedSummaryRoutes(app, pool);
    const r = await app.inject({ method: 'GET', url: '/api/cloud/unsynced-summary' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { count: number; approxBytes: number; sessionIds: string[] };
    expect(body.count).toBe(2);  // A and C; B excluded because synced_at IS NOT NULL
    expect(new Set(body.sessionIds)).toEqual(new Set([A, C]));
    expect(body.approxBytes).toBe(3 * 32);  // A has 3 rows × 32 bytes; C has 0
    await app.close();
  });
});
