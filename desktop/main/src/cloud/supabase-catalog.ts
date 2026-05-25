import type { SupabaseClient } from '@supabase/supabase-js';
import type { Manifest } from '../parquet/manifest.ts';

export class AlreadySyncedError extends Error {
  constructor(public existing: { uploaded_by_machine: string | null; uploaded_at: string | null }) {
    super('session already synced');
  }
}

export async function commitSessionToCatalog(
  sb: SupabaseClient,
  args: {
    sessionId: string;
    sessionRow: Record<string, unknown>;
    manifest: Manifest;
    totalBytes: number;
    machine: string;
  },
): Promise<void> {
  // Pre-check: if a row with this content_hash already exists, raise.
  const { data: existing, error: selErr } = await sb
    .from('sessions')
    .select('id, uploaded_by_machine, uploaded_at')
    .eq('content_hash', args.manifest.session_content_hash)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && existing.id !== args.sessionId) {
    throw new AlreadySyncedError({
      uploaded_by_machine: existing.uploaded_by_machine,
      uploaded_at: existing.uploaded_at,
    });
  }

  // Upsert the session row with cloud bookkeeping columns. The local schema
  // has columns the cloud schema doesn't (synced_at, local_deleted_at) — only
  // send the cloud-side fields so PostgREST's schema cache doesn't reject the
  // request.
  const sessionPayload = {
    id: args.sessionId,
    date: args.sessionRow.date,
    started_at: args.sessionRow.started_at,
    ended_at: args.sessionRow.ended_at,
    track: args.sessionRow.track,
    driver: args.sessionRow.driver,
    car: args.sessionRow.car,
    notes: args.sessionRow.notes,
    source: args.sessionRow.source,
    source_file: args.sessionRow.source_file,
    source_file_hash: args.sessionRow.source_file_hash,
    content_hash: args.manifest.session_content_hash,
    manifest_key: `sessions/${args.sessionId}/manifest.json`,
    total_bytes: args.totalBytes,
    uploaded_by_machine: args.machine,
    uploaded_at: new Date().toISOString(),
  };
  const { error: upErr } = await sb.from('sessions').upsert(sessionPayload, { onConflict: 'id' });
  if (upErr) {
    if ((upErr as { code?: string }).code === '23505') {
      throw new AlreadySyncedError({ uploaded_by_machine: null, uploaded_at: null });
    }
    throw upErr;
  }

  const blobRows = args.manifest.files.map((f) => ({
    session_id: args.sessionId,
    source: f.source,
    object_key: f.object_key,
    bytes: f.bytes,
    row_count: f.row_count,
    content_hash: f.sha256,
  }));
  const { error: bErr } = await sb.from('session_blobs').upsert(blobRows, {
    onConflict: 'session_id,source',
  });
  if (bErr) throw bErr;
}
