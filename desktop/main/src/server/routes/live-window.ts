import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export interface LiveWindowDeps { pool: pg.Pool }

interface Q { ids?: string; start?: string; end?: string; bucket?: string }

export function registerLiveWindowRoutes(app: FastifyInstance, deps: LiveWindowDeps) {
  app.get('/api/live/window', async (req, reply) => {
    const q = (req.query ?? {}) as Q;
    const ids = (q.ids ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const start = q.start ?? '';
    const end = q.end ?? '';
    const bucket = Number(q.bucket ?? 0);
    if (ids.length === 0 || !start || !end || !(bucket > 0)) {
      reply.code(400);
      return { error: 'expected ?ids=&start=&end=&bucket=' };
    }
    const { rows } = await deps.pool.query(
      `SELECT * FROM get_live_today_window($1::int[], $2::timestamptz, $3::timestamptz, $4::double precision)`,
      [ids, start, end, bucket],
    );
    return rows;
  });

  // Testing/dev helper: wipe the daily live buffer. Cheap, no FKs to
  // cascade. Use case is the user wanting to re-seed the page with a
  // clean slate during basestation testing.
  app.post('/api/live/reset', async () => {
    const { rowCount } = await deps.pool.query('DELETE FROM live_today');
    return { deleted: rowCount ?? 0 };
  });
}
