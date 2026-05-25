import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '../../cloud/supabase-client.ts';
import { makePublicSpaces } from '../../cloud/spaces-public.ts';
import { listCloudSessionsGroupedByDay } from '../../cloud/list.ts';
import { pullSession } from '../../cloud/pull.ts';
import { deleteLocalSessionRows, estimateLocalBytes } from '../../db/local-delete.ts';
import type { CloudDefaults } from '../../cloud/defaults.ts';
import { getEffectiveCloudConfig } from '../../cloud/effective-config.ts';

export function registerCloudPullRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  pgConnStr: string,
  cloudDefaults: CloudDefaults,
) {
  async function readDeps() {
    const eff = await getEffectiveCloudConfig(pool, cloudDefaults);
    if (!eff.supabaseUrl || !eff.supabaseAnonKey || !eff.spacesPublicBase) {
      throw new Error('cloud read not configured (missing supabase URL/anon-key or spaces public base)');
    }
    return {
      sb: createClient(eff.supabaseUrl, eff.supabaseAnonKey),
      spaces: makePublicSpaces(eff.spacesPublicBase),
    };
  }

  app.get('/api/cloud/sessions', async () => {
    const { sb } = await readDeps();
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM sessions');
    const local = new Set(rows.map((r) => r.id));
    return await listCloudSessionsGroupedByDay(sb, local);
  });

  app.post<{ Body: { ids: string[] } }>('/api/cloud/pull', async (req, reply) => {
    const { sb, spaces } = await readDeps();
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
