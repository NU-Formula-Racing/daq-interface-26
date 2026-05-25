import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { restoreSessions } from './restore-from-backup.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const SID = '44444444-0000-0000-0000-000000000004';

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
  await pool.end();
});

describe('restoreSessions', () => {
  it('inserts session + readings, translating cloud signal_id → local id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rst-'));
    // signal_definitions backup row uses cloud id=999
    await writeFile(join(dir, 'signal_definitions.ndjson.gz'),
      gzipSync(Buffer.from(JSON.stringify(
        { id: 999, source: 'PDM', signal_name: 'BusV', unit: 'V' }
      ) + '\n')));
    // sessions backup row
    await writeFile(join(dir, 'sessions.ndjson.gz'),
      gzipSync(Buffer.from(JSON.stringify({
        id: SID, date: '2026-05-24',
        started_at: '2026-05-24T00:00:00+00:00',
        ended_at:   '2026-05-24T00:01:00+00:00',
        source: 'sd_import', source_file: 'x.nfr',
        source_file_hash: null, track: null, driver: null, car: null, notes: null,
      }) + '\n')));
    // one partition file with two readings, both referencing cloud id 999
    await writeFile(join(dir, 'sd_readings_2026_05.ndjson.gz'),
      gzipSync(Buffer.from(
        [
          { ts: '2026-05-24T00:00:01+00:00', value: 12.3, signal_id: 999, session_id: SID },
          { ts: '2026-05-24T00:00:02+00:00', value: 12.4, signal_id: 999, session_id: SID },
        ].map((o) => JSON.stringify(o)).join('\n') + '\n')));

    const summary = await restoreSessions({
      pool,
      backupDir: dir,
      sessionIds: [SID],
    });
    expect(summary).toEqual({ sessions: 1, rows: 2 });

    const { rows: r } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM sd_readings WHERE session_id = $1', [SID]);
    expect(Number(r[0].n)).toBe(2);
  });
});
