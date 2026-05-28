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
            synced_at, manifest_key, uploaded_by_machine, uploaded_at
     FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (srows.length === 0) throw new Error(`session ${sessionId} not found`);
  const sessionRow = srows[0];

  // Dedup: if this session has already been uploaded via the Parquet flow,
  // raise immediately. Gate on manifest_key (set only on real Spaces uploads),
  // not synced_at, because pre-migration sync code wrote synced_at without
  // ever putting bytes in Spaces.
  if (sessionRow.manifest_key) {
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

    // 6. Upload signal_map.json sidecar.
    //
    // The desktop assigns signal_definitions.id locally; the cloud catalog
    // assigns its own. Parquets are written with LOCAL ids, but the website's
    // signals-window edge function gets cloud ids in its request. The
    // sidecar lets the edge function translate cloud_id → local_id by joining
    // on (source, name) without any cloud DB write on the upload path. See
    // docs/desktop-signal-map-upload.md and supabase/functions/signals-window/.
    const { rows: mapRows } = await pool.query<{
      local_id: number; source: string; name: string;
    }>(
      `SELECT DISTINCT sd.id AS local_id, sd.source, sd.signal_name AS name
       FROM sd_readings r
       JOIN signal_definitions sd ON sd.id = r.signal_id
       WHERE r.session_id = $1
       ORDER BY sd.source, sd.signal_name`,
      [sessionId],
    );
    const signalMap = {
      session_id: sessionId,
      signals: mapRows.map((r) => ({ local_id: r.local_id, source: r.source, name: r.name })),
    };
    const signalMapKey = `sessions/${sessionId}/signal_map.json`;
    await spaces.putBytes(
      signalMapKey,
      Buffer.from(JSON.stringify(signalMap)),
      'application/json',
    );

    // 7. Upload manifest.json.
    const manifestKey = `sessions/${sessionId}/manifest.json`;
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
    await spaces.putBytes(manifestKey, manifestBody, 'application/json');
    const mback = await spaces.getString(manifestKey);
    const parsed = JSON.parse(mback);
    if (parsed.session_content_hash !== manifest.session_content_hash) {
      throw new Error('manifest readback hash mismatch');
    }

    // 8. Commit to cloud catalog.
    await commitSessionToCatalog(sb, {
      sessionId, sessionRow, manifest, totalBytes, machine,
    });

    // 9. Mirror blobs locally + mark synced (only now).
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
