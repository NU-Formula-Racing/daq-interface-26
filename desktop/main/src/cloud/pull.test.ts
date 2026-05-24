import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { makeSpaces } from './spaces.ts';
import { uploadSession } from './upload.ts';
import { pullSession } from './pull.ts';

const PG = process.env.PG_TEST_URL!;
const pool = new Pool({ connectionString: PG });
const spaces = makeSpaces({
  endpoint: process.env.MINIO_URL!, region: 'us-east-1', bucket: 'test',
  accessKey: 'test', secretKey: 'testtest', forcePathStyle: true,
});
const SID = '66666666-6666-6666-6666-666666666666';

// In-memory mock Supabase that stores the seeded session for pullSession to retrieve.
const cloudSessions = new Map<string, Record<string, unknown>>();
const cloudBlobs: Array<Record<string, unknown>> = [];

function makeMockSb() {
  return {
    from(table: string) {
      if (table === 'sessions') {
        return {
          select(_cols: string) {
            return {
              // Used by uploadSession dedup check (maybeSingle)
              eq(_col: string, _val: unknown) {
                return {
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  // Used by pullSession single()
                  single: () => {
                    const row = cloudSessions.get(SID) ?? null;
                    return Promise.resolve({ data: row, error: row ? null : { message: 'not found' } });
                  },
                };
              },
              // Used by uploadSession upload.ts pre-check
              eq2: undefined,
            };
          },
          upsert(payload: Record<string, unknown>) {
            cloudSessions.set(payload.id as string, payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'session_blobs') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { data: [], error: null };
              },
            };
          },
          upsert(rows: Array<Record<string, unknown>>) {
            cloudBlobs.push(...rows);
            return Promise.resolve({ error: null });
          },
          delete() {
            return {
              eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
            };
          },
        };
      }
      return {};
    },
  } as any;
}

beforeAll(async () => {
  await spaces.ensureBucket();
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (6001, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT (id) DO NOTHING`, [SID]);
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 6001, 7.7),
    ('2026-05-24T00:00:02Z', $1, 6001, 8.8)`, [SID]);
  const sb = makeMockSb();
  await uploadSession({ sessionId: SID, pool, sb, spaces, machine: 'src', pgConnStr: PG });
  // Wipe local rows so the pull has work to do.
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM session_blobs WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
  await pool.end();
});

describe('pullSession', () => {
  it('downloads, verifies, and imports rows', async () => {
    const sb = makeMockSb();
    const r = await pullSession({ sessionId: SID, pool, sb, spaces, pgConnStr: PG });
    expect(r.rowCount).toBe(2);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [SID]);
    expect(Number(rows[0].n)).toBe(2);
  });

  it('rolls back when a file hash mismatches', async () => {
    // Corrupt one parquet object in MinIO.
    await spaces.putBytes(`sessions/${SID}/PDM.parquet`, Buffer.from('garbage'));
    await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
    const sb = makeMockSb();
    await expect(
      pullSession({ sessionId: SID, pool, sb, spaces, pgConnStr: PG })
    ).rejects.toThrow(/hash mismatch/);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [SID]);
    expect(Number(rows[0].n)).toBe(0);
  });
});
