import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  getSessionSignalIds,
  getSignalsWindow,
  getSignalWindow,
  listSignalDefinitions,
} from '../../db/signals.ts';

export function registerSignalRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/signal-definitions', async () => listSignalDefinitions(pool));

  app.get<{
    Params: { id: string };
    Querystring: { session: string; start: string; end: string };
  }>(
    '/api/signals/:id/window',
    async (req) => {
      const signalId = Number(req.params.id);
      const { session, start, end } = req.query;
      return getSignalWindow(pool, session, signalId, start, end);
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/signal-ids',
    async (req) => getSessionSignalIds(pool, req.params.id)
  );

  app.get<{
    Params: { id: string };
    Querystring: { ids: string; start: string; end: string; bucket: string };
  }>(
    '/api/sessions/:id/signals/window',
    async (req, reply) => {
      const { ids, start, end, bucket } = req.query;
      if (!ids || !start || !end || !bucket) {
        reply.code(400);
        return { error: 'missing_query_param' };
      }
      const signalIds = ids
        .split(',')
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
      const bucketSecs = Number(bucket);
      if (!Number.isFinite(bucketSecs) || bucketSecs <= 0) {
        reply.code(400);
        return { error: 'invalid_bucket' };
      }
      const t0 = performance.now();
      const result = await getSignalsWindow(pool, req.params.id, signalIds, start, end, bucketSecs);
      console.log(
        `[signals-window] route total=${(performance.now() - t0).toFixed(0)}ms ` +
        `(includes query+map; subtract the inner log to get serialization wait)`,
      );
      return result;
    }
  );
}
