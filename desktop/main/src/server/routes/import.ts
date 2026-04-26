import type { FastifyInstance } from 'fastify';

const MAX_NFR_BYTES = 200 * 1024 * 1024; // 200 MB per file

export interface ImportResult {
  session_id: string | null;
  row_count: number;
  error?: string;
}

export interface ImportDeps {
  /** Called per uploaded file. Saves to disk + runs parser batch + returns result. */
  onImport: (filename: string, body: Buffer) => Promise<ImportResult>;
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
      try {
        const result = await deps.onImport(filename, body);
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
}
