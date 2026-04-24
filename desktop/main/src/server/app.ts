import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { EventEmitter } from 'events';
import websocketPlugin from '@fastify/websocket';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'fs';
import { registerAuth } from './auth.ts';
import { getAppConfig, setAppConfig } from '../db/config.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerSignalRoutes } from './routes/signals.ts';
import { registerWebSockets } from './ws.ts';
import { registerLiveRoutes } from './routes/live.ts';
import { registerSyncRoutes, type CloudPusherFactory } from './routes/sync.ts';

export interface BuildAppOptions {
  pool: pg.Pool;
  parser?: EventEmitter;
  authToken?: string | null;
  logger?: boolean;
  cloudPusherFactory?: CloudPusherFactory;
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

  app.get('/api/config', async () => {
    const cfg = await getAppConfig(opts.pool);
    // Never expose auth secrets to API consumers (incl. broadcast peers).
    const { authToken: _omit, ...safe } = cfg as Record<string, unknown>;
    return safe;
  });

  app.post<{ Body: Record<string, unknown> }>(
    '/api/config',
    async (req) => {
      await setAppConfig(opts.pool, req.body ?? {});
      return { ok: true };
    }
  );

  registerSessionRoutes(app, opts.pool);
  registerSignalRoutes(app, opts.pool);
  registerSyncRoutes(app, opts.pool, opts.cloudPusherFactory);

  // Serve the built React app as a fallback for non-API, non-WS paths.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // From desktop/main/src/server/ up to repo root + app/dist
  const staticRoot = resolve(__dirname, '..', '..', '..', '..', 'app', 'dist');

  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: false,
      setHeaders: (reply: any) => {
        reply.setHeader('Cache-Control', 'no-cache');
      },
    });
    // Client-side router fallback: any non-/api, non-/ws path returns index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply
        .type('text/html')
        .send(
          `<!doctype html><h1>NFR UI not built</h1><p>Run <code>cd app && npm run build</code>.</p>`,
        );
    });
  }

  return app;
}
