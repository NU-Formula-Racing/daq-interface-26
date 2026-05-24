import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { upsertBlob, listBlobs, deleteBlobsForSession } from './blobs.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const S = '44444444-4444-4444-4444-444444444444';

beforeAll(async () => {
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT (id) DO NOTHING`, [S]);
});
afterAll(async () => {
  await pool.query('DELETE FROM sessions WHERE id = $1', [S]);
  await pool.end();
});

describe('blobs db accessor', () => {
  it('upserts and lists', async () => {
    await upsertBlob(pool, {
      sessionId: S, source: 'PDM', objectKey: 'k/PDM.parquet',
      bytes: 10, rowCount: 5, contentHash: 'a'.repeat(64),
    });
    await upsertBlob(pool, {
      sessionId: S, source: 'PDM', objectKey: 'k/PDM.parquet',
      bytes: 11, rowCount: 6, contentHash: 'b'.repeat(64),
    });
    const list = await listBlobs(pool, S);
    expect(list).toHaveLength(1);
    expect(list[0].bytes).toBe(11);
    await deleteBlobsForSession(pool, S);
    expect(await listBlobs(pool, S)).toHaveLength(0);
  });
});
