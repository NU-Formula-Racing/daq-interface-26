import type pg from 'pg';

export interface BlobRow {
  session_id: string;
  source: string;
  object_key: string;
  bytes: number;
  row_count: number;
  content_hash: string;
  uploaded_at: string;
}

export async function upsertBlob(pool: pg.Pool, b: {
  sessionId: string;
  source: string;
  objectKey: string;
  bytes: number;
  rowCount: number;
  contentHash: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO session_blobs (session_id, source, object_key, bytes, row_count, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, source) DO UPDATE SET
       object_key   = EXCLUDED.object_key,
       bytes        = EXCLUDED.bytes,
       row_count    = EXCLUDED.row_count,
       content_hash = EXCLUDED.content_hash,
       uploaded_at  = now()`,
    [b.sessionId, b.source, b.objectKey, b.bytes, b.rowCount, b.contentHash],
  );
}

export async function listBlobs(pool: pg.Pool, sessionId: string): Promise<BlobRow[]> {
  const { rows } = await pool.query<BlobRow>(
    `SELECT session_id, source, object_key,
            bytes::int AS bytes, row_count::int AS row_count,
            content_hash, uploaded_at::text
     FROM session_blobs WHERE session_id = $1 ORDER BY source`,
    [sessionId],
  );
  return rows;
}

export async function deleteBlobsForSession(pool: pg.Pool, sessionId: string): Promise<void> {
  await pool.query('DELETE FROM session_blobs WHERE session_id = $1', [sessionId]);
}
