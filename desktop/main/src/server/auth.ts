import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * When `token` is non-null, every /api/* and /ws/* request must carry the
 * matching token, supplied either as `?key=<token>` or as an
 * `Authorization: Bearer <token>` header. Other paths (e.g. /static/*) are
 * unaffected.
 */
export function registerAuth(app: FastifyInstance, token: string | null): void {
  if (!token) return;

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url;
    if (!url.startsWith('/api/') && !url.startsWith('/ws/')) return;

    const query = req.query as Record<string, string | undefined>;
    const header = req.headers.authorization;
    const supplied =
      query.key ??
      (header && header.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (supplied !== token) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
