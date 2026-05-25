import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../../db/config.ts';

/**
 * GET /api/spaces/status — return non-secret Spaces config + presence flags
 * for the secret fields. Mirrors the /api/sync/status convention so the
 * frontend never receives raw access/secret keys in a response.
 */
interface SpacesStatus {
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  hasAccessKey: boolean;
  hasSecretKey: boolean;
  configured: boolean;
  cloudLiveEnabled: boolean;
}

export function registerSpacesConfigRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/spaces/status', async (): Promise<SpacesStatus> => {
    const cfg = await getAppConfig(pool);
    const endpoint = typeof cfg.spacesEndpoint === 'string' ? cfg.spacesEndpoint : null;
    const region = typeof cfg.spacesRegion === 'string' ? cfg.spacesRegion : null;
    const bucket = typeof cfg.spacesBucket === 'string' ? cfg.spacesBucket : null;
    const hasAccessKey = typeof cfg.spacesAccessKey === 'string' && cfg.spacesAccessKey.length > 0;
    const hasSecretKey = typeof cfg.spacesSecretKey === 'string' && cfg.spacesSecretKey.length > 0;
    return {
      endpoint, region, bucket, hasAccessKey, hasSecretKey,
      configured: !!(endpoint && region && bucket && hasAccessKey && hasSecretKey),
      cloudLiveEnabled: cfg.cloudLiveEnabled === true,
    };
  });

  /** Save patch — drops empty strings so users typing nothing don't blank out
   *  existing secrets by accident. Triggers no parser restart (these keys
   *  are not in the parser path). */
  app.post<{ Body: Record<string, unknown> }>(
    '/api/spaces/config',
    async (req) => {
      const patch: Record<string, unknown> = {};
      const KEYS = [
        'spacesEndpoint', 'spacesRegion', 'spacesBucket',
        'spacesAccessKey', 'spacesSecretKey',
      ] as const;
      for (const k of KEYS) {
        const v = req.body?.[k];
        if (typeof v === 'string' && v.length > 0) patch[k] = v;
      }
      // Boolean toggle: explicitly accept both true and false (don't skip on
      // false the way we skip empty strings).
      if (typeof req.body?.cloudLiveEnabled === 'boolean') {
        patch.cloudLiveEnabled = req.body.cloudLiveEnabled;
      }
      if (Object.keys(patch).length === 0) return { ok: true, noop: true };
      await setAppConfig(pool, patch);
      return { ok: true };
    },
  );
}
