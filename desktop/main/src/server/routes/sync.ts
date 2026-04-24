import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig } from '../../db/config.ts';
import {
  localReaderFromPool,
  pushSessionsToCloud,
  supabaseCloudPusher,
  type CloudPusher,
} from '../../sync/supabase.ts';

export type CloudPusherFactory = (url: string, anonKey: string) => CloudPusher;

export function registerSyncRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  factory: CloudPusherFactory = supabaseCloudPusher,
) {
  app.post('/api/sync/push', async (_req, reply) => {
    const cfg = await getAppConfig(pool);
    const url = typeof cfg.supabaseUrl === 'string' ? cfg.supabaseUrl : null;
    const key =
      typeof cfg.supabaseAnonKey === 'string' ? cfg.supabaseAnonKey : null;
    if (!url || !key) {
      reply.code(400);
      return { error: 'Supabase credentials not configured in app_config' };
    }

    const pusher = factory(url, key);
    const reader = localReaderFromPool(pool);
    return pushSessionsToCloud(reader, pusher);
  });
}
