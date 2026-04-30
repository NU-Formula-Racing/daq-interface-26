import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../../db/config.ts';
import {
  localReaderFromPool,
  pushSessionsToCloud,
  supabaseCloudPusher,
  type CloudPusher,
} from '../../sync/supabase.ts';
import { postgresCloudPusher } from '../../sync/postgres.ts';

export type CloudPusherFactory = (url: string, anonKey: string) => CloudPusher;

type CloudBackend = 'supabase' | 'postgres';

interface CloudConfig {
  cloudBackend: CloudBackend | null;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  cloudPgUrl: string | null;
}

function readCloudConfig(cfg: Record<string, unknown>): CloudConfig {
  const backend = cfg.cloudBackend;
  return {
    cloudBackend:
      backend === 'supabase' || backend === 'postgres' ? backend : null,
    supabaseUrl: typeof cfg.supabaseUrl === 'string' ? cfg.supabaseUrl : null,
    supabaseAnonKey:
      typeof cfg.supabaseAnonKey === 'string' ? cfg.supabaseAnonKey : null,
    cloudPgUrl: typeof cfg.cloudPgUrl === 'string' ? cfg.cloudPgUrl : null,
  };
}

function isConfigured(c: CloudConfig): boolean {
  if (c.cloudBackend === 'supabase')
    return !!(c.supabaseUrl && c.supabaseAnonKey);
  if (c.cloudBackend === 'postgres') return !!c.cloudPgUrl;
  return false;
}

function buildPusher(
  c: CloudConfig,
  supabaseFactory: CloudPusherFactory,
): (CloudPusher & { close?: () => Promise<void> }) | null {
  if (c.cloudBackend === 'supabase' && c.supabaseUrl && c.supabaseAnonKey) {
    return supabaseFactory(c.supabaseUrl, c.supabaseAnonKey);
  }
  if (c.cloudBackend === 'postgres' && c.cloudPgUrl) {
    return postgresCloudPusher(c.cloudPgUrl);
  }
  return null;
}

export function registerSyncRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  factory: CloudPusherFactory = supabaseCloudPusher,
) {
  app.get('/api/sync/status', async () => {
    const cfg = readCloudConfig(await getAppConfig(pool));
    const { rows: pending } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sessions
       WHERE synced_at IS NULL AND ended_at IS NOT NULL`,
    );
    const { rows: synced } = await pool.query<{
      n: string;
      last: Date | null;
    }>(
      `SELECT count(*)::text AS n, max(synced_at) AS last
       FROM sessions WHERE synced_at IS NOT NULL`,
    );
    return {
      cloudBackend: cfg.cloudBackend,
      configured: isConfigured(cfg),
      // Echo back which fields are set (NOT the values themselves) so the UI
      // can show "(set)" placeholders without leaking creds.
      hasSupabaseUrl: !!cfg.supabaseUrl,
      hasSupabaseKey: !!cfg.supabaseAnonKey,
      hasPgUrl: !!cfg.cloudPgUrl,
      unsyncedSessions: Number(pending[0]?.n ?? '0'),
      syncedSessions: Number(synced[0]?.n ?? '0'),
      lastSyncedAt: synced[0]?.last?.toISOString() ?? null,
    };
  });

  app.post<{
    Body: Partial<{
      cloudBackend: CloudBackend;
      supabaseUrl: string;
      supabaseAnonKey: string;
      cloudPgUrl: string;
    }>;
  }>('/api/sync/config', async (req, reply) => {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (body.cloudBackend === 'supabase' || body.cloudBackend === 'postgres') {
      patch.cloudBackend = body.cloudBackend;
    }
    // Only persist values the caller actually sent — empty string clears.
    if (typeof body.supabaseUrl === 'string') patch.supabaseUrl = body.supabaseUrl;
    if (typeof body.supabaseAnonKey === 'string')
      patch.supabaseAnonKey = body.supabaseAnonKey;
    if (typeof body.cloudPgUrl === 'string') patch.cloudPgUrl = body.cloudPgUrl;
    if (Object.keys(patch).length === 0) {
      reply.code(400);
      return { error: 'no recognized fields in body' };
    }
    await setAppConfig(pool, patch);
    return { ok: true };
  });

  app.post('/api/sync/push', async (_req, reply) => {
    const cfg = readCloudConfig(await getAppConfig(pool));
    if (!isConfigured(cfg)) {
      reply.code(400);
      return { error: 'cloud sync is not configured' };
    }
    const pusher = buildPusher(cfg, factory);
    if (!pusher) {
      reply.code(400);
      return { error: 'cloud sync is not configured' };
    }
    try {
      const reader = localReaderFromPool(pool);
      return await pushSessionsToCloud(reader, pusher);
    } finally {
      // Direct-pg pusher needs to close its pool; supabase-js pusher doesn't.
      if (pusher.close) await pusher.close();
    }
  });
}
