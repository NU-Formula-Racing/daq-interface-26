import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { writeFile } from 'fs/promises';
import { setAppConfig } from '../../db/config.ts';

export interface DbcUploadDeps {
  pool: pg.Pool;
  /** Where uploaded DBC CSVs are written. */
  storePath: string;
  /** Called after the DBC is saved + config updated; restarts the parser. */
  onDbcChanged: () => Promise<void>;
}

export function registerDbcRoutes(app: FastifyInstance, deps: DbcUploadDeps) {
  app.post('/api/dbc/upload', async (req, reply) => {
    let body = '';
    if (typeof req.body === 'string') {
      body = req.body;
    } else if (req.body && typeof req.body === 'object' && 'csv' in (req.body as any)) {
      body = String((req.body as any).csv);
    } else {
      reply.code(400);
      return { error: 'expected CSV body (text/csv or {"csv": "..."} JSON)' };
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      reply.code(400);
      return { error: 'empty CSV' };
    }
    const firstLine = trimmed.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
    if (!firstLine.includes('message id') || !firstLine.includes('signal name')) {
      reply.code(400);
      return { error: 'CSV header must include "Message ID" and "Signal Name" columns' };
    }

    await writeFile(deps.storePath, trimmed + '\n', 'utf-8');
    await setAppConfig(deps.pool, { dbcPath: deps.storePath });

    try {
      await deps.onDbcChanged();
    } catch (err) {
      reply.code(500);
      return { error: 'saved DBC but failed to restart parser', detail: String(err) };
    }

    return { ok: true, path: deps.storePath };
  });

  app.get('/api/dbc/status', async () => {
    const { rows } = await deps.pool.query<{ data: any }>(
      'SELECT data FROM app_config WHERE id = 1',
    );
    return {
      active: typeof rows[0]?.data?.dbcPath === 'string' ? rows[0].data.dbcPath : null,
    };
  });
}
