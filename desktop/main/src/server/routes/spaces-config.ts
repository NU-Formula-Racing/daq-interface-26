import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../../db/config.ts';

/**
 * GET /api/cloud/status — non-secret cloud config + presence flags for the
 * secret fields. Covers both halves of the cloud setup (Supabase metastore
 * and DO Spaces bulk store) so the frontend can render a single panel.
 *
 * Endpoint name kept under /api/spaces/* historically; alias /api/cloud/*
 * for clarity. Same handler for both.
 */
interface CloudStatus {
  // Supabase
  supabaseUrl: string | null;
  hasSupabaseAnonKey: boolean;
  // DigitalOcean Spaces
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  hasSpacesAccessKey: boolean;
  hasSpacesSecretKey: boolean;
  // Aggregate
  spacesConfigured: boolean;
  supabaseConfigured: boolean;
  cloudLiveEnabled: boolean;
}

const PLAIN_KEYS = [
  'supabaseUrl',
  'spacesEndpoint', 'spacesRegion', 'spacesBucket',
] as const;
const SECRET_KEYS = [
  'supabaseAnonKey',
  'spacesAccessKey', 'spacesSecretKey',
] as const;

export function registerSpacesConfigRoutes(app: FastifyInstance, pool: pg.Pool) {
  const buildStatus = async (): Promise<CloudStatus> => {
    const cfg = await getAppConfig(pool);
    const str = (k: keyof typeof cfg) =>
      typeof cfg[k] === 'string' ? (cfg[k] as string) : null;
    const has = (k: keyof typeof cfg) =>
      typeof cfg[k] === 'string' && (cfg[k] as string).length > 0;

    const supabaseUrl = str('supabaseUrl');
    const hasSupabaseAnonKey = has('supabaseAnonKey');
    const spacesEndpoint = str('spacesEndpoint');
    const spacesRegion = str('spacesRegion');
    const spacesBucket = str('spacesBucket');
    const hasSpacesAccessKey = has('spacesAccessKey');
    const hasSpacesSecretKey = has('spacesSecretKey');

    return {
      supabaseUrl, hasSupabaseAnonKey,
      spacesEndpoint, spacesRegion, spacesBucket,
      hasSpacesAccessKey, hasSpacesSecretKey,
      spacesConfigured: !!(spacesEndpoint && spacesRegion && spacesBucket
                          && hasSpacesAccessKey && hasSpacesSecretKey),
      supabaseConfigured: !!(supabaseUrl && hasSupabaseAnonKey),
      cloudLiveEnabled: cfg.cloudLiveEnabled === true,
    };
  };

  app.get('/api/cloud/status', buildStatus);
  // Back-compat alias — same payload, was the original endpoint name.
  app.get('/api/spaces/status', buildStatus);

  const savePatch = async (body: Record<string, unknown>) => {
    const patch: Record<string, unknown> = {};
    for (const k of [...PLAIN_KEYS, ...SECRET_KEYS]) {
      const v = body[k];
      if (typeof v === 'string' && v.length > 0) patch[k] = v;
    }
    if (typeof body.cloudLiveEnabled === 'boolean') {
      patch.cloudLiveEnabled = body.cloudLiveEnabled;
    }
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };
    await setAppConfig(pool, patch);
    return { ok: true };
  };

  app.post<{ Body: Record<string, unknown> }>(
    '/api/cloud/config', async (req) => savePatch(req.body ?? {}),
  );
  app.post<{ Body: Record<string, unknown> }>(
    '/api/spaces/config', async (req) => savePatch(req.body ?? {}),
  );
}
