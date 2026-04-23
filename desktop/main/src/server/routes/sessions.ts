import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  deleteSession,
  getSession,
  getSessionOverview,
  listSessions,
  updateSession,
  type SessionPatch,
} from '../../db/sessions.ts';

export function registerSessionRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/sessions', async () => listSessions(pool));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const detail = await getSession(pool, req.params.id);
    if (!detail) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return detail;
  });

  app.patch<{ Params: { id: string }; Body: SessionPatch }>(
    '/api/sessions/:id',
    async (req) => {
      await updateSession(pool, req.params.id, req.body ?? {});
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (req, reply) => {
      await deleteSession(pool, req.params.id);
      reply.code(204);
      return;
    }
  );

  app.get<{ Params: { id: string }; Querystring: { bucket?: string } }>(
    '/api/sessions/:id/overview',
    async (req) => {
      const bucket = Number(req.query.bucket ?? '10');
      return getSessionOverview(pool, req.params.id, bucket);
    }
  );
}
