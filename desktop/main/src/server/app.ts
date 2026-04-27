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
import { registerExportRoutes } from './routes/export.ts';
import { registerSetupRoutes, type SetupState } from './routes/setup.ts';
import { registerDbcRoutes } from './routes/dbc.ts';
import { registerDbAdminRoutes } from './routes/db_admin.ts';
import { registerImportRoutes, type ImportResult } from './routes/import.ts';
import { registerCatalogRoutes, type CatalogDeps } from './routes/catalog.ts';
import { registerBroadcastRoutes, type BroadcastDeps } from './routes/broadcast.ts';

export interface BuildAppOptions {
  pool: pg.Pool | null;
  parser?: EventEmitter;
  authToken?: string | null;
  logger?: boolean;
  cloudPusherFactory?: CloudPusherFactory;
  setupState?: SetupState;
  staticRoot?: string;
  dbcStorePath?: string;
  onDbcChanged?: () => Promise<void>;
  dsn?: string;
  onImport?: (filename: string, body: Buffer) => Promise<ImportResult>;
  catalogDeps?: CatalogDeps;
  broadcastDeps?: BroadcastDeps;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.addContentTypeParser(
    ['text/csv', 'text/plain', 'application/sql'],
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  const setupState: SetupState = opts.setupState ?? {
    status: opts.pool ? 'ok' : 'not_reachable',
    lastError: null,
  };
  registerSetupRoutes(app, setupState);

  // In degraded mode, block all /api/* and /ws/* except /api/setup/* and /api/db/catalog*.
  if (!opts.pool) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.url.startsWith('/api/setup/')) return;
      if (req.url.startsWith('/api/db/catalog')) return;
      if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
        reply.code(503).send({ error: 'service_unavailable', reason: 'postgres unreachable' });
      }
    });
  }

  if (opts.catalogDeps) {
    registerCatalogRoutes(app, opts.catalogDeps);
  }

  if (opts.pool) {
    const pool = opts.pool;
    registerAuth(app, opts.authToken ?? null);

    await app.register(websocketPlugin);
    if (opts.parser) {
      registerWebSockets(app, opts.parser);
      registerLiveRoutes(app, opts.parser);
    }

    app.get('/api/health', async () => ({ status: 'ok' }));

    app.get('/api/config', async () => {
      const cfg = await getAppConfig(pool);
      // Never expose auth secrets to API consumers (incl. broadcast peers).
      const { authToken: _omit, ...safe } = cfg as Record<string, unknown>;
      return safe;
    });

    app.post<{ Body: Record<string, unknown> }>(
      '/api/config',
      async (req) => {
        await setAppConfig(pool, req.body ?? {});
        return { ok: true };
      }
    );

    registerSessionRoutes(app, pool);
    registerSignalRoutes(app, pool);
    registerExportRoutes(app, pool);
    registerSyncRoutes(app, pool, opts.cloudPusherFactory);
    if (opts.dbcStorePath && opts.onDbcChanged) {
      registerDbcRoutes(app, {
        pool,
        storePath: opts.dbcStorePath,
        onDbcChanged: opts.onDbcChanged,
      });
    }
    if (opts.dsn) {
      registerDbAdminRoutes(app, { pool: opts.pool, dsn: opts.dsn });
    }
    if (opts.onImport) {
      registerImportRoutes(app, { onImport: opts.onImport });
    }
    if (opts.broadcastDeps) {
      registerBroadcastRoutes(app, opts.broadcastDeps);
    }
  }

  // Serve the built React app as a fallback for non-API, non-WS paths.
  let staticRoot: string;
  if (opts.staticRoot) {
    staticRoot = opts.staticRoot;
  } else {
    // Dev fallback: from desktop/main/src/server/ up to repo root + app/dist
    const __dirname = dirname(fileURLToPath(import.meta.url));
    staticRoot = resolve(__dirname, '..', '..', '..', '..', 'app', 'dist');
  }

  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
      wildcard: true,
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
