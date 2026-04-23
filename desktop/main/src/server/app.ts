import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { EventEmitter } from 'events';
import websocketPlugin from '@fastify/websocket';
import { registerAuth } from './auth.ts';
import { getAppConfig, setAppConfig } from '../db/config.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerSignalRoutes } from './routes/signals.ts';
import { registerWebSockets } from './ws.ts';
import { registerLiveRoutes } from './routes/live.ts';

export interface BuildAppOptions {
  pool: pg.Pool;
  parser?: EventEmitter;
  authToken?: string | null;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  registerAuth(app, opts.authToken ?? null);

  await app.register(websocketPlugin);
  if (opts.parser) {
    registerWebSockets(app, opts.parser);
    registerLiveRoutes(app, opts.parser);
  }

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
