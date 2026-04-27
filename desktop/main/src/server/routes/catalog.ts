import type { FastifyInstance } from 'fastify';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadCatalog,
  addEntry,
  switchActive,
  removeEntry,
} from '../../db/catalog.ts';

export interface CatalogDeps {
  catalogPath: string; // <userData>/nfr-catalog.json
  initializeDataDir: (path: string) => Promise<void>; // run initdb at path
  isNfrDataDir: (path: string) => Promise<boolean>; // verify PG_VERSION etc.
  signalRestart: () => void; // tells orchestrator to exit(0)
}

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogDeps): void {
  app.get<{ Querystring: { path?: string } }>('/api/db/probe', async (req, reply) => {
    const p = req.query.path;
    if (!p || typeof p !== 'string') {
      reply.code(400);
      return { error: 'path query parameter required' };
    }
    const exists = existsSync(p);
    const hasPgVersion = exists && existsSync(join(p, 'PG_VERSION'));
    return { exists, hasPgVersion };
  });

  app.get('/api/db/catalog', async () => {
    const cat = await loadCatalog(deps.catalogPath);
    const entries = cat.entries.map((e) => ({
      ...e,
      reachable: existsSync(e.path) && existsSync(join(e.path, 'PG_VERSION')),
    }));
    return { active: cat.active, entries };
  });

  app.post<{ Body: { name: string; path: string } }>(
    '/api/db/catalog/create',
    async (req, reply) => {
      const { name, path } = req.body;
      if (existsSync(join(path, 'PG_VERSION'))) {
        reply.code(409);
        return { error: 'data directory already exists at ' + path };
      }
      await deps.initializeDataDir(path);
      await addEntry(deps.catalogPath, { name, path });
      await switchActive(deps.catalogPath, path);
      deps.signalRestart();
      return { ok: true, restarting: true };
    },
  );

  app.post<{ Body: { name: string; path: string } }>(
    '/api/db/catalog/connect',
    async (req, reply) => {
      const { name, path } = req.body;
      if (!(await deps.isNfrDataDir(path))) {
        reply.code(400);
        return { error: 'not a valid NFR Postgres data directory: ' + path };
      }
      await addEntry(deps.catalogPath, { name, path });
      await switchActive(deps.catalogPath, path);
      deps.signalRestart();
      return { ok: true, restarting: true };
    },
  );

  app.post<{ Body: { path: string } }>('/api/db/catalog/switch', async (req, reply) => {
    try {
      await switchActive(deps.catalogPath, req.body.path);
    } catch (err) {
      reply.code(404);
      return { error: (err as Error).message };
    }
    deps.signalRestart();
    return { ok: true, restarting: true };
  });

  app.post<{ Body: { path: string } }>('/api/db/catalog/remove', async (req) => {
    const cat = await removeEntry(deps.catalogPath, req.body.path);
    const restarting = cat.active === null;
    if (restarting) deps.signalRestart();
    return { ok: true, restarting };
  });

  app.post<{ Body: { path: string; confirm: true } }>(
    '/api/db/catalog/delete',
    async (req, reply) => {
      if (req.body.confirm !== true) {
        reply.code(400);
        return { error: 'confirm flag required' };
      }
      const cat = await removeEntry(deps.catalogPath, req.body.path);
      if (existsSync(req.body.path)) {
        rmSync(req.body.path, { recursive: true, force: true });
      }
      const restarting = cat.active === null;
      if (restarting) deps.signalRestart();
      return { ok: true, restarting };
    },
  );
}
