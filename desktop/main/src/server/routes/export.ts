import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * GET /api/sessions/:id/export.csv
 *
 * Streams every reading for a session as CSV, joined to its signal name +
 * source. Reads from BOTH `sd_readings` and `rt_readings` so an active live
 * session (where readings haven't been flushed yet) still exports cleanly.
 */
export function registerExportRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/export.csv',
    async (req, reply) => {
      const id = req.params.id;
      const { rows } = await pool.query<{
        ts: Date;
        source: string;
        signal_name: string;
        unit: string | null;
        value: string;
      }>(
        `SELECT r.ts, sd.source, sd.signal_name, sd.unit, r.value
         FROM (
           SELECT ts, signal_id, value FROM sd_readings WHERE session_id = $1
           UNION ALL
           SELECT ts, signal_id, value FROM rt_readings WHERE session_id = $1
         ) r
         JOIN signal_definitions sd ON sd.id = r.signal_id
         ORDER BY r.ts`,
        [id],
      );

      const shortId = id.slice(0, 8);
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header(
        'Content-Disposition',
        `attachment; filename="session-${shortId}.csv"`,
      );

      const parts: string[] = ['ts,source,signal_name,unit,value\n'];
      for (const r of rows) {
        parts.push(
          [
            r.ts.toISOString(),
            csvEscape(r.source),
            csvEscape(r.signal_name),
            csvEscape(r.unit ?? ''),
            String(r.value),
          ].join(',') + '\n',
        );
      }
      return parts.join('');
    },
  );
}
