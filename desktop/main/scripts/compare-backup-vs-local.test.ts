import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { computeDiff } from './compare-backup-vs-local.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const LOCAL_ONLY  = '11111111-0000-0000-0000-000000000001';
const BOTH        = '22222222-0000-0000-0000-000000000002';
const BACKUP_ONLY = '33333333-0000-0000-0000-000000000003';

beforeAll(async () => {
  for (const id of [LOCAL_ONLY, BOTH]) {
    await pool.query(
      `INSERT INTO sessions (id, date, started_at, source) VALUES
       ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'sd_import')
       ON CONFLICT (id) DO NOTHING`, [id]);
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[LOCAL_ONLY, BOTH]]);
  await pool.end();
});

describe('computeDiff', () => {
  it('classifies UUIDs into local-only / both / backup-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cmp-'));
    const sessionsPath = join(dir, 'sessions.ndjson.gz');
    const rows = [
      { id: BOTH },
      { id: BACKUP_ONLY },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(sessionsPath, gzipSync(Buffer.from(rows)));

    const diff = await computeDiff({ pool, sessionsNdjsonPath: sessionsPath });
    expect(new Set(diff.localOnly)).toEqual(new Set([LOCAL_ONLY]));
    expect(new Set(diff.both)).toEqual(new Set([BOTH]));
    expect(new Set(diff.backupOnly)).toEqual(new Set([BACKUP_ONLY]));
  });
});
