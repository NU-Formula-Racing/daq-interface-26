import type { FastifyInstance } from 'fastify';

const MAX_NFR_BYTES = 200 * 1024 * 1024; // 200 MB per file

export interface ImportResult {
  session_id: string | null;
  row_count: number;
  /** True when the file was dedup-skipped (same source_file_hash already in DB)
   *  and the parser was not re-run. The returned row_count is the existing
   *  session's count, not a fresh decode. */
  skipped?: boolean;
  error?: string;
}

export interface ImportDeps {
  /** Called per uploaded file. Saves to disk + runs parser batch + returns result.
   *  When `reparse` is true, the dedup short-circuit is skipped so the parser
   *  re-decodes the file with the current DBC and overwrites prior rows. */
  onImport: (filename: string, body: Buffer, reparse: boolean) => Promise<ImportResult>;
  /** Kill any currently-running parser child process. Returns true if a child
   *  was killed, false if nothing was running. The parser commits in one
   *  transaction so a kill mid-parse leaves the DB untouched for that file. */
  onCancel: () => boolean;
}

/**
 * POST /api/import/nfr
 *
 * Accepts a single .nfr file as `application/octet-stream`. The original
 * filename is taken from the `X-Filename` header (used as the session's
 * `source_file`). Returns the imported session id + row count on success.
 *
 * For folder/multi-file uploads the UI calls this endpoint once per file.
 */
export function registerImportRoutes(app: FastifyInstance, deps: ImportDeps) {
  app.post(
    '/api/import/nfr',
    { bodyLimit: MAX_NFR_BYTES },
    async (req, reply) => {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        reply.code(400);
        return { error: 'expected binary .nfr body (Content-Type: application/octet-stream)' };
      }
      const headerName = req.headers['x-filename'];
      const filename =
        typeof headerName === 'string' && headerName.length > 0
          ? headerName
          : `upload-${Date.now()}.nfr`;
      const q = (req.query ?? {}) as Record<string, unknown>;
      const reparse = q.reparse === '1' || q.reparse === 'true';
      try {
        const result = await deps.onImport(filename, body, reparse);
        if (result.error) {
          reply.code(500);
          return result;
        }
        return result;
      } catch (err) {
        reply.code(500);
        return { error: String(err) };
      }
    },
  );

  // Cancel any parser child currently spawned by /api/import/nfr. The client
  // calls this from its CANCEL button; cheap and idempotent.
  app.post('/api/import/cancel', async () => {
    const killed = deps.onCancel();
    return { killed };
  });
}
