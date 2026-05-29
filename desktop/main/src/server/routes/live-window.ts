import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export interface LiveWindowDeps { pool: pg.Pool }

interface Q { ids?: string; start?: string; end?: string; bucket?: string; raw?: string }

/** Hard cap on rows returned in raw mode. ~100k rows × small payload is
 *  fine on the WS side, but we don't want a runaway query to OOM the
 *  embedded PG if someone scrolls back to a several-hour window. */
const RAW_ROW_CAP = 100_000;

export function registerLiveWindowRoutes(app: FastifyInstance, deps: LiveWindowDeps) {
  app.get('/api/live/window', async (req, reply) => {
    const q = (req.query ?? {}) as Q;
    const ids = (q.ids ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const start = q.start ?? '';
    const end = q.end ?? '';
    const raw = q.raw === '1' || q.raw === 'true';
    if (ids.length === 0 || !start || !end) {
      reply.code(400);
      return { error: 'expected ?ids=&start=&end=(&bucket= | &raw=1)' };
    }
    if (raw) {
      // Raw rows — no bucket averaging. Avg-per-bucket produced fractional
      // values and wrap-spikes for integer / cyclic signals like RTC_Second;
      // live mode wants the actual sample. Each row reports value_avg =
      // value_min = value_max = the sample, sample_n = 1 so the existing
      // app frame-store ingest path keeps working unchanged.
      const { rows } = await deps.pool.query(
        `SELECT r.ts, r.signal_id, d.signal_name, d.unit,
                r.value AS value_min, r.value AS value_max,
                r.value AS value_avg, 1::int AS sample_n
         FROM live_today r
         JOIN signal_definitions d ON d.id = r.signal_id
         WHERE r.signal_id = ANY($1::int[])
           AND r.ts >= $2::timestamptz AND r.ts < $3::timestamptz
         ORDER BY r.ts
         LIMIT $4`,
        [ids, start, end, RAW_ROW_CAP],
      );
      return rows;
    }
    const bucket = Number(q.bucket ?? 0);
    if (!(bucket > 0)) {
      reply.code(400);
      return { error: 'bucket must be > 0 unless raw=1' };
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
