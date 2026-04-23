import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../db/config.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerSignalRoutes } from './routes/signals.ts';

export interface BuildAppOptions {
  pool: pg.Pool;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/config', async () => getAppConfig(opts.pool));

  app.post<{ Body: Record<string, unknown> }>(
    '/api/config',
    async (req) => {
      await setAppConfig(opts.pool, req.body ?? {});
      return { ok: true };
    }
  );

  registerSessionRoutes(app, opts.pool);
  registerSignalRoutes(app, opts.pool);

  return app;
}
