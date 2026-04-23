import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getSignalWindow, listSignalDefinitions } from '../../db/signals.ts';

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
}
