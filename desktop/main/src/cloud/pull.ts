import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from '../parquet/manifest.ts';
import { importParquetIntoSession } from '../parquet/reader.ts';
import { upsertBlob } from '../db/blobs.ts';
import type { SpacesClient } from './spaces.ts';

export interface PullResult {
  rowCount: number;
  files: number;
}

export async function pullSession(opts: {
  sessionId: string;
  pool: pg.Pool;
  sb: SupabaseClient;
  spaces: SpacesClient;
  pgConnStr: string;
}): Promise<PullResult> {
  const { sessionId, pool, sb, spaces, pgConnStr } = opts;

  // 1. Fetch session metadata + manifest key from Supabase.
  const { data: sessRow, error: sErr } = await sb.from('sessions')
    .select('id, date, started_at, ended_at, track, driver, car, notes, source, source_file, source_file_hash, content_hash, manifest_key')
    .eq('id', sessionId).single();
  if (sErr) throw sErr;
  if (!sessRow.manifest_key) throw new Error('session has no manifest');

  // 2. Download + verify manifest.
  const manifestRaw = await spaces.getString(sessRow.manifest_key);
  const manifest = parseManifest(manifestRaw);
  if (manifest.session_content_hash !== sessRow.content_hash) {
    throw new Error('manifest hash mismatch with catalog');
  }

  // 3. Download each Parquet, hash-verify against manifest.
  const dir = await mkdtemp(join(tmpdir(), `pull-${sessionId}-`));
  let totalRows = 0;
  try {
    const downloaded: Array<{ source: string; localPath: string; manifestEntry: typeof manifest.files[number] }> = [];
    for (const f of manifest.files) {
      const local = join(dir, `${f.source.replace(/[^A-Za-z0-9_.-]/g, '_')}.parquet`);
      // Download the full file; use head().contentLength so we get whatever is actually stored.
      const head = await spaces.head(f.object_key);
      const body = await spaces.probeBytes(f.object_key, 0, head.contentLength);
      await writeFile(local, body);
      const sha = createHash('sha256').update(await readFile(local)).digest('hex');
      if (sha !== f.sha256) throw new Error(`${f.object_key}: hash mismatch`);
      downloaded.push({ source: f.source, localPath: local, manifestEntry: f });
    }

    // 4. Single-transaction import into local PG.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Insert session row, mirroring cloud columns.
      await client.query(
        `INSERT INTO sessions (id, date, started_at, ended_at, track, driver, car, notes,
                               source, source_file, source_file_hash,
                               content_hash, manifest_key, total_bytes, uploaded_at, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (id) DO NOTHING`,
        [sessRow.id, sessRow.date, sessRow.started_at, sessRow.ended_at, sessRow.track, sessRow.driver,
         sessRow.car, sessRow.notes, sessRow.source, sessRow.source_file, sessRow.source_file_hash,
         sessRow.content_hash, sessRow.manifest_key,
         downloaded.reduce((a, d) => a + d.manifestEntry.bytes, 0),
         new Date().toISOString(), new Date().toISOString()],
      );
      // Commit the sessions insert first so the FK on sd_readings is satisfied.
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    for (const d of downloaded) {
      const { rowCount } = await importParquetIntoSession({
        sessionId, parquetPath: d.localPath, pgConnStr,
      });
      totalRows += rowCount;
      await upsertBlob(pool, {
        sessionId, source: d.source, objectKey: d.manifestEntry.object_key,
        bytes: d.manifestEntry.bytes, rowCount: d.manifestEntry.row_count,
        contentHash: d.manifestEntry.sha256,
      });
    }

    return { rowCount: totalRows, files: downloaded.length };
  } catch (e) {
    // Roll back any rows that did make it in.
    await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [sessionId]);
    await pool.query('DELETE FROM session_blobs WHERE session_id = $1', [sessionId]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
