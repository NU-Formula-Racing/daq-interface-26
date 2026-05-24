import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { makeSpaces } from '../../cloud/spaces.ts';
import { getAppConfig } from '../../db/config.ts';
import { listCloudSessionsGroupedByDay } from '../../cloud/list.ts';
import { pullSession } from '../../cloud/pull.ts';
import { deleteLocalSessionRows, estimateLocalBytes } from '../../db/local-delete.ts';

export function registerCloudPullRoutes(app: FastifyInstance, pool: pg.Pool, pgConnStr: string) {
  async function spacesAndSb() {
    const cfg = await getAppConfig(pool);
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey ||
        !cfg.spacesEndpoint || !cfg.spacesBucket ||
        !cfg.spacesAccessKey || !cfg.spacesSecretKey) {
      throw new Error('cloud not configured');
    }
    return {
      sb: createClient(cfg.supabaseUrl as string, cfg.supabaseAnonKey as string),
      spaces: makeSpaces({
        endpoint: cfg.spacesEndpoint as string, region: (cfg.spacesRegion as string | null | undefined) ?? 'us-east-1',
        bucket: cfg.spacesBucket as string, accessKey: cfg.spacesAccessKey as string, secretKey: cfg.spacesSecretKey as string,
      }),
    };
  }

  app.get('/api/cloud/sessions', async () => {
    const { sb } = await spacesAndSb();
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM sessions');
    const local = new Set(rows.map((r) => r.id));
    return await listCloudSessionsGroupedByDay(sb, local);
  });

  app.post<{ Body: { ids: string[] } }>('/api/cloud/pull', async (req, reply) => {
    const { sb, spaces } = await spacesAndSb();
    const results: Array<{ id: string; ok: boolean; error?: string; rowCount?: number }> = [];
    for (const id of req.body.ids) {
      try {
        const r = await pullSession({ sessionId: id, pool, sb, spaces, pgConnStr });
        results.push({ id, ok: true, rowCount: r.rowCount });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return reply.send({ results });
  });

  app.post<{ Body: { ids: string[] } }>('/api/local/delete', async (req) => {
    const est = await estimateLocalBytes(pool, req.body.ids);
    await deleteLocalSessionRows(pool, req.body.ids);
    return { deleted: req.body.ids.length, approxBytesFreed: est };
  });

  app.post<{ Body: { ids: string[] } }>('/api/local/estimate', async (req) => {
    return { approxBytes: await estimateLocalBytes(pool, req.body.ids) };
  });
}
