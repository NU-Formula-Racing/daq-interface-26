import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionParquet } from '../parquet/writer.ts';
import { buildManifest } from '../parquet/manifest.ts';
import { upsertBlob } from '../db/blobs.ts';
import { commitSessionToCatalog, AlreadySyncedError } from './supabase-catalog.ts';
import type { SpacesClient } from './spaces.ts';

export { AlreadySyncedError };

export interface UploadResult {
  uploadedBytes: number;
  files: number;
  contentHash: string;
}

export async function uploadSession(opts: {
  sessionId: string;
  pool: pg.Pool;
  sb: SupabaseClient;
  spaces: SpacesClient;
  machine: string;
  pgConnStr: string;
}): Promise<UploadResult> {
  const { sessionId, pool, sb, spaces, machine, pgConnStr } = opts;

  // 1. Read session row.
  const { rows: srows } = await pool.query(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, source_file_hash,
            synced_at, uploaded_by_machine, uploaded_at
     FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (srows.length === 0) throw new Error(`session ${sessionId} not found`);
  const sessionRow = srows[0];

  // Dedup: if already synced locally, raise immediately.
  if (sessionRow.synced_at) {
    throw new AlreadySyncedError({
      uploaded_by_machine: sessionRow.uploaded_by_machine ?? null,
      uploaded_at: sessionRow.uploaded_at?.toISOString?.() ?? String(sessionRow.uploaded_at) ?? null,
    });
  }

  const dir = await mkdtemp(join(tmpdir(), `up-${sessionId}-`));
  try {
    // 2. Write parquet files locally.
    const files = await writeSessionParquet({ sessionId, outDir: dir, pgConnStr });
    if (files.length === 0) throw new Error('session has no readings');

    // 3. Build manifest.
    const manifestObjs = files.map((f) => ({
      source: f.source,
      objectKey: `sessions/${sessionId}/${f.source.replace(/[^A-Za-z0-9_.-]/g, '_')}.parquet`,
      bytes: f.bytes,
      rowCount: f.rowCount,
      sha256: f.sha256,
    }));
    const manifest = buildManifest({
      sessionId, createdAt: new Date().toISOString(), files: manifestObjs,
    });

    // 4. Dedup pre-check via Supabase.
    const { data: existing } = await sb.from('sessions')
      .select('id, uploaded_by_machine, uploaded_at')
      .eq('content_hash', manifest.session_content_hash).maybeSingle();
    if (existing && existing.id !== sessionId) {
      throw new AlreadySyncedError({
        uploaded_by_machine: existing.uploaded_by_machine,
        uploaded_at: existing.uploaded_at,
      });
    }

    // 5. Upload each Parquet, then verify.
    let totalBytes = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const key = manifestObjs[i].objectKey;
      await spaces.putFile(key, f.localPath, 'application/vnd.apache.parquet');
      const head = await spaces.head(key);
      if (head.contentLength !== f.bytes) {
        throw new Error(`upload size mismatch for ${key}: got ${head.contentLength}, want ${f.bytes}`);
      }
      // Probe first + last 16KB so a truncated body is caught cheaply.
      const probeLen = Math.min(16384, f.bytes);
      const head16 = await spaces.probeBytes(key, 0, probeLen);
      const tail16 = await spaces.probeBytes(key, Math.max(0, f.bytes - probeLen), probeLen);
      if (head16.length !== probeLen || tail16.length !== probeLen) {
        throw new Error(`probe length mismatch for ${key}`);
      }
      totalBytes += f.bytes;
    }

    // 6. Upload manifest.json.
    const manifestKey = `sessions/${sessionId}/manifest.json`;
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
    await spaces.putBytes(manifestKey, manifestBody, 'application/json');
    const mback = await spaces.getString(manifestKey);
    const parsed = JSON.parse(mback);
    if (parsed.session_content_hash !== manifest.session_content_hash) {
      throw new Error('manifest readback hash mismatch');
    }

    // 7. Commit to cloud catalog.
    await commitSessionToCatalog(sb, {
      sessionId, sessionRow, manifest, totalBytes, machine,
    });

    // 8. Mirror blobs locally + mark synced (only now).
    for (const m of manifest.files) {
      await upsertBlob(pool, {
        sessionId, source: m.source, objectKey: m.object_key,
        bytes: m.bytes, rowCount: m.row_count, contentHash: m.sha256,
      });
    }
    await pool.query(
      `UPDATE sessions SET
         synced_at = now(),
         content_hash = $2,
         manifest_key = $3,
         total_bytes = $4,
         uploaded_by_machine = $5,
         uploaded_at = now()
       WHERE id = $1`,
      [sessionId, manifest.session_content_hash, manifestKey, totalBytes, machine],
    );

    return { uploadedBytes: totalBytes, files: files.length, contentHash: manifest.session_content_hash };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
