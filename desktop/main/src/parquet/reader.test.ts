import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionParquet } from './writer.ts';
import { importParquetIntoSession } from './reader.ts';

const PG = process.env.PG_TEST_URL!;
const pool = new Pool({ connectionString: PG });
const SRC = '22222222-2222-2222-2222-222222222222';
const DST = '33333333-3333-3333-3333-333333333333';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (2001, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  for (const s of [SRC, DST]) {
    await pool.query(
      `INSERT INTO sessions (id, date, started_at, source) VALUES ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live')
       ON CONFLICT (id) DO NOTHING`, [s]);
  }
  await pool.query(
    `INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
       ('2026-05-24T00:00:01Z', $1, 2001, 1.0),
       ('2026-05-24T00:00:02Z', $1, 2001, 2.0)`, [SRC]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = ANY($1)', [[SRC, DST]]);
  await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[SRC, DST]]);
  await pool.end();
});

describe('importParquetIntoSession', () => {
  it('round-trips rows from SRC into DST', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pq-r-'));
    try {
      const files = await writeSessionParquet({ sessionId: SRC, outDir: dir, pgConnStr: PG });
      for (const f of files) {
        await importParquetIntoSession({ sessionId: DST, parquetPath: f.localPath, pgConnStr: PG });
      }
      const { rows } = await pool.query<{ n: string }>(
        'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [DST]);
      expect(Number(rows[0].n)).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
