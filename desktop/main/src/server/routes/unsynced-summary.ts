import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface UnsyncedSummary {
  count: number;
  approxBytes: number;
  sessionIds: string[];
}

export function registerUnsyncedSummaryRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/cloud/unsynced-summary', async (): Promise<UnsyncedSummary> => {
    // Only SD imports go through the Spaces upload path. Live sessions sync
    // to Supabase on their own schedule and have no Parquet representation,
    // so they should never appear here as "unsynced".
    const { rows } = await pool.query<{ id: string; row_count: string }>(
      `SELECT s.id, COALESCE(c.row_count, 0)::text AS row_count
       FROM sessions s
       LEFT JOIN (
         SELECT session_id, COUNT(*)::bigint AS row_count
         FROM sd_readings
         GROUP BY session_id
       ) c ON c.session_id = s.id
       WHERE s.manifest_key IS NULL
         AND s.source = 'sd_import'
       ORDER BY s.started_at DESC`,
    );
    const sessionIds = rows.map((r) => r.id);
    const approxBytes = rows.reduce((sum, r) => sum + Number(r.row_count) * 32, 0);
    return { count: sessionIds.length, approxBytes, sessionIds };
  });
}
