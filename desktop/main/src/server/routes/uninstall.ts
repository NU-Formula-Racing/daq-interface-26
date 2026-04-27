import type { FastifyInstance } from 'fastify';
import { rmSync, existsSync } from 'fs';
import { loadCatalog } from '../../db/catalog.ts';

export interface UninstallDeps {
  catalogPath: string;
  userDataDir: string;
  /** Called after wiping; should make the app process quit without relaunching. */
  signalQuit: () => void;
}

export function registerUninstallRoutes(app: FastifyInstance, deps: UninstallDeps) {
  app.post<{ Body: { confirm: string } }>('/api/uninstall', async (req, reply) => {
    if (req.body?.confirm !== 'UNINSTALL') {
      reply.code(400);
      return { error: 'confirm must be the literal string "UNINSTALL"' };
    }

    const removed: string[] = [];
    const errors: { path: string; error: string }[] = [];

    const tryRm = (p: string) => {
      if (!existsSync(p)) return;
      try {
        rmSync(p, { recursive: true, force: true });
        removed.push(p);
      } catch (err) {
        errors.push({ path: p, error: (err as Error).message });
      }
    };

    try {
      const cat = await loadCatalog(deps.catalogPath);
      for (const entry of cat.entries) tryRm(entry.path);
    } catch {
      /* ignore — catalog file missing or unreadable */
    }
    tryRm(deps.catalogPath);
    tryRm(deps.userDataDir);

    setTimeout(() => deps.signalQuit(), 250);
    return { ok: true, removed, errors };
  });
}
