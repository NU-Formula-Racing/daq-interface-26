import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import Cursor from 'pg-cursor';

const BATCH_SIZE = 5000;

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type Row = {
  ts: Date;
  source: string;
  signal_name: string;
  unit: string | null;
  value: string;
};

/**
 * GET /api/sessions/:id/export.csv
 *
 * Streams every reading for a session as CSV, joined to its signal name +
 * source. Reads from BOTH `sd_readings` and `rt_readings` so an active live
 * session (where readings haven't been flushed yet) still exports cleanly.
 *
 * Uses a server-side Postgres cursor so the full result set is never
 * materialized in Node — long sessions used to OOM when the entire CSV was
 * buffered, and a keyset-paged version re-sorted on every batch because the
 * `sd_readings` index is keyed `(session_id, signal_id, ts)`, not by ts.
 */
export function registerExportRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/export.csv',
    async (req, reply) => {
      const id = req.params.id;
      const shortId = id.slice(0, 8);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="session-${shortId}.csv"`,
      );

      const stream = Readable.from(rowChunks(pool, id), {
        objectMode: false,
      });
      return reply.send(stream);
    },
  );
}

async function* rowChunks(
  pool: pg.Pool,
  sessionId: string,
): AsyncGenerator<string> {
  const client = await pool.connect();
  const cursor = client.query(
    new Cursor<Row>(
      `SELECT r.ts, sd.source, sd.signal_name, sd.unit, r.value
         FROM (
           SELECT ts, signal_id, value FROM sd_readings WHERE session_id = $1
           UNION ALL
           SELECT ts, signal_id, value FROM rt_readings WHERE session_id = $1
         ) r
         JOIN signal_definitions sd ON sd.id = r.signal_id
        ORDER BY r.ts`,
      [sessionId],
    ),
  );

  try {
    yield 'ts,source,signal_name,unit,value\n';
    while (true) {
      const rows = await cursor.read(BATCH_SIZE);
      if (rows.length === 0) return;
      let buf = '';
      for (const r of rows) {
        buf +=
          [
            r.ts.toISOString(),
            csvEscape(r.source),
            csvEscape(r.signal_name),
            csvEscape(r.unit ?? ''),
            String(r.value),
          ].join(',') + '\n';
      }
      yield buf;
    }
  } finally {
    await cursor.close().catch(() => {});
    client.release();
  }
}
