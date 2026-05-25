import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../../db/config.ts';
import type { CloudDefaults } from '../../cloud/defaults.ts';
import { getEffectiveCloudConfig } from '../../cloud/effective-config.ts';

interface CloudStatus {
  // User-set values (never secrets — only string fields the user pasted)
  supabaseUrl: string | null;
  hasSupabaseAnonKey: boolean;
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  hasSpacesAccessKey: boolean;
  hasSpacesSecretKey: boolean;
  // Bundled defaults — informational, displayed read-only
  defaults: {
    supabaseUrl: string | null;
    hasSupabaseAnonKey: boolean;
    spacesPublicBase: string | null;
  };
  // Aggregate flags computed by the resolver
  spacesWriteReady: boolean;
  supabaseReadReady: boolean;
  spacesReadReady: boolean;
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

export function registerSpacesConfigRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  cloudDefaults: CloudDefaults,
) {
  const buildStatus = async (): Promise<CloudStatus> => {
    const cfg = await getAppConfig(pool);
    const eff = await getEffectiveCloudConfig(pool, cloudDefaults);
    const str = (k: keyof typeof cfg) =>
      typeof cfg[k] === 'string' ? (cfg[k] as string) : null;
    const has = (k: keyof typeof cfg) =>
      typeof cfg[k] === 'string' && (cfg[k] as string).length > 0;

    return {
      supabaseUrl: str('supabaseUrl'),
      hasSupabaseAnonKey: has('supabaseAnonKey'),
      spacesEndpoint: str('spacesEndpoint'),
      spacesRegion: str('spacesRegion'),
      spacesBucket: str('spacesBucket'),
      hasSpacesAccessKey: has('spacesAccessKey'),
      hasSpacesSecretKey: has('spacesSecretKey'),
      defaults: {
        supabaseUrl: cloudDefaults.supabaseUrl,
        hasSupabaseAnonKey: !!cloudDefaults.supabaseAnonKey,
        spacesPublicBase: cloudDefaults.spacesPublicBase,
      },
      spacesWriteReady: eff.spacesWriteReady,
      supabaseReadReady: !!(eff.supabaseUrl && eff.supabaseAnonKey),
      spacesReadReady: !!eff.spacesPublicBase,
      cloudLiveEnabled: eff.cloudLiveEnabled,
    };
  };

  app.get('/api/cloud/status', buildStatus);
  app.get('/api/spaces/status', buildStatus);  // back-compat alias

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
