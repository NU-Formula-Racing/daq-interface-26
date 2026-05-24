import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { makeSpaces } from './spaces.ts';
import { uploadSession, AlreadySyncedError } from './upload.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const SID = '55555555-5555-5555-5555-555555555555';

// Hand-rolled mock SupabaseClient that covers commitSessionToCatalog's surface:
//   from('sessions').select(...).eq(...).maybeSingle()
//   from('sessions').upsert(...)
//   from('session_blobs').upsert(...)
// Also covers the pre-check inside uploadSession itself.
const cloudSessions: Map<string, Record<string, unknown>> = new Map();
const cloudBlobs: Array<Record<string, unknown>> = [];

function makeMockSupabase(): SupabaseClient {
  const builder = (table: string) => ({
    _table: table,
    _filters: {} as Record<string, unknown>,
    _selectCols: '*',

    select(cols: string) {
      this._selectCols = cols;
      return this;
    },
    eq(col: string, val: unknown) {
      this._filters[col] = val;
      return this;
    },
    async maybeSingle() {
      if (this._table === 'sessions') {
        const hash = this._filters['content_hash'];
        if (hash) {
          for (const [, row] of cloudSessions) {
            if (row['content_hash'] === hash) {
              return { data: row, error: null };
            }
          }
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    async upsert(rows: unknown, _opts?: unknown) {
      if (this._table === 'sessions') {
        const r = Array.isArray(rows) ? rows[0] : rows;
        cloudSessions.set(r.id, r as Record<string, unknown>);
      } else if (this._table === 'session_blobs') {
        const arr = Array.isArray(rows) ? rows : [rows];
        for (const b of arr) cloudBlobs.push(b as Record<string, unknown>);
      }
      return { error: null };
    },
    async delete() {
      if (this._table === 'sessions') {
        for (const [k, row] of cloudSessions) {
          if (this._filters['session_id'] === row['session_id'] ||
              this._filters['id'] === row['id'] ||
              this._filters['id'] === k) {
            cloudSessions.delete(k);
          }
        }
      }
      return { error: null };
    },
  });

  return {
    from: (table: string) => builder(table),
  } as unknown as SupabaseClient;
}

const sb = makeMockSupabase();

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (5001, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT (id) DO NOTHING`, [SID]);
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 5001, 1.0),
    ('2026-05-24T00:00:02Z', $1, 5001, 2.0)`, [SID]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
  await pool.end();
});

const spaces = makeSpaces({
  endpoint: process.env.MINIO_URL!, region: 'us-east-1', bucket: 'test',
  accessKey: 'test', secretKey: 'testtest', forcePathStyle: true,
});

describe('uploadSession', () => {
  it('uploads, verifies, and marks synced exactly once', async () => {
    await spaces.ensureBucket();
    const r = await uploadSession({ sessionId: SID, pool, sb, spaces, machine: 'test-machine', pgConnStr: process.env.PG_TEST_URL! });
    expect(r.uploadedBytes).toBeGreaterThan(0);
    const { rows } = await pool.query('SELECT synced_at, content_hash FROM sessions WHERE id = $1', [SID]);
    expect(rows[0].synced_at).not.toBeNull();
    expect(rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws AlreadySyncedError on duplicate upload', async () => {
    await expect(
      uploadSession({ sessionId: SID, pool, sb, spaces, machine: 'other', pgConnStr: process.env.PG_TEST_URL! })
    ).rejects.toBeInstanceOf(AlreadySyncedError);
  });
});
