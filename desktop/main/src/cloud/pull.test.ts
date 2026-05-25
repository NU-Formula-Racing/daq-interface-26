import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { makeSpaces } from './spaces.ts';
import { makePublicSpaces } from './spaces-public.ts';
import { uploadSession } from './upload.ts';
import { pullSession } from './pull.ts';

const PG = process.env.PG_TEST_URL!;
const pool = new Pool({ connectionString: PG });
const spaces = makeSpaces({
  endpoint: process.env.MINIO_URL!, region: 'us-east-1', bucket: 'test',
  accessKey: 'test', secretKey: 'testtest', forcePathStyle: true,
});
const SID = '66666666-6666-6666-6666-666666666666';

// HTTP fixture server — mirrors files from MinIO into a local temp dir and
// serves them over plain HTTP so the pull side can use PublicSpaces.
let fixtureDir: string;
let fixtureBase: string;
let fixtureServer: http.Server;

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
              eq(_col: string, _val: unknown) {
                return {
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  single: () => {
                    const row = cloudSessions.get(SID) ?? null;
                    return Promise.resolve({ data: row, error: row ? null : { message: 'not found' } });
                  },
                };
              },
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

async function mirrorToFixture(sessionId: string) {
  const s3 = new S3Client({
    endpoint: process.env.MINIO_URL!, region: 'us-east-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'testtest' },
    forcePathStyle: true,
  });
  const dir = join(fixtureDir, 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  for (const key of ['manifest.json', 'PDM.parquet']) {
    const r = await s3.send(new GetObjectCommand({
      Bucket: 'test', Key: `sessions/${sessionId}/${key}`,
    }));
    const buf: Buffer[] = [];
    for await (const chunk of (r.Body as Readable)) buf.push(chunk as Buffer);
    writeFileSync(join(dir, key), Buffer.concat(buf));
  }
}

beforeAll(async () => {
  // Set up HTTP fixture server
  fixtureDir = mkdtempSync(join(tmpdir(), 'pull-fixture-'));
  fixtureServer = http.createServer((req, res) => {
    if (!req.url) { res.writeHead(404); return res.end(); }
    const path = join(fixtureDir, req.url);
    try {
      const body = readFileSync(path);
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-length': String(body.length) });
        res.end();
      } else {
        res.writeHead(200, { 'content-length': String(body.length) });
        res.end(body);
      }
    } catch {
      res.writeHead(404); res.end();
    }
  });
  await new Promise<void>((r) => fixtureServer.listen(0, '127.0.0.1', r));
  const addr = fixtureServer.address() as { port: number };
  fixtureBase = `http://127.0.0.1:${addr.port}`;

  // Upload via real S3 (MinIO), then mirror to HTTP fixture
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
  // Mirror MinIO objects into fixture dir for the HTTP server
  await mirrorToFixture(SID);
  // Wipe local rows so the pull has work to do.
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
});

afterAll(async () => {
  await new Promise<void>((r) => fixtureServer.close(() => r()));
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM session_blobs WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
  await pool.end();
});

describe('pullSession', () => {
  it('downloads, verifies, and imports rows', async () => {
    const sb = makeMockSb();
    const r = await pullSession({ sessionId: SID, pool, sb, spaces: makePublicSpaces(fixtureBase), pgConnStr: PG });
    expect(r.rowCount).toBe(2);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [SID]);
    expect(Number(rows[0].n)).toBe(2);
  });

  it('rolls back when a file hash mismatches', async () => {
    // Corrupt the fixture file to simulate hash mismatch
    const parquetPath = join(fixtureDir, 'sessions', SID, 'PDM.parquet');
    const origSize = readFileSync(parquetPath).length;
    writeFileSync(parquetPath, Buffer.alloc(origSize, 0)); // same size, different content
    await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
    const sb = makeMockSb();
    await expect(
      pullSession({ sessionId: SID, pool, sb, spaces: makePublicSpaces(fixtureBase), pgConnStr: PG })
    ).rejects.toThrow(/hash mismatch/);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [SID]);
    expect(Number(rows[0].n)).toBe(0);
  });
});
