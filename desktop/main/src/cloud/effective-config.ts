import type pg from 'pg';
import { getAppConfig } from '../db/config.ts';
import type { CloudDefaults } from './defaults.ts';

export interface EffectiveCloudConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  spacesPublicBase: string | null;
  spacesEndpoint: string | null;
  spacesRegion: string | null;
  spacesBucket: string | null;
  spacesAccessKey: string | null;
  spacesSecretKey: string | null;
  cloudLiveEnabled: boolean;
  /** Convenience: true iff all five Spaces write fields are populated. */
  spacesWriteReady: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function getEffectiveCloudConfig(
  pool: pg.Pool,
  defaults: CloudDefaults,
): Promise<EffectiveCloudConfig> {
  const cfg = await getAppConfig(pool);

  const userSupabaseUrl     = str(cfg.supabaseUrl);
  const userSupabaseAnonKey = str(cfg.supabaseAnonKey);
  const userSpacesEndpoint  = str(cfg.spacesEndpoint);
  const userSpacesRegion    = str(cfg.spacesRegion);
  const userSpacesBucket    = str(cfg.spacesBucket);
  const userSpacesAccess    = str(cfg.spacesAccessKey);
  const userSpacesSecret    = str(cfg.spacesSecretKey);

  // spacesPublicBase derivation: if the user provided endpoint+region+bucket,
  // compose from them so reads go to the user's bucket (matches where writes
  // go). Otherwise fall back to the bundled default.
  let spacesPublicBase: string | null = defaults.spacesPublicBase;
  if (userSpacesBucket && userSpacesRegion) {
    spacesPublicBase = `https://${userSpacesBucket}.${userSpacesRegion}.digitaloceanspaces.com`;
  }

  const spacesEndpoint = userSpacesEndpoint;
  const spacesRegion   = userSpacesRegion;
  const spacesBucket   = userSpacesBucket;
  const spacesAccessKey = userSpacesAccess;
  const spacesSecretKey = userSpacesSecret;
  const spacesWriteReady = !!(spacesEndpoint && spacesRegion && spacesBucket
    && spacesAccessKey && spacesSecretKey);

  return {
    supabaseUrl: userSupabaseUrl ?? defaults.supabaseUrl,
    supabaseAnonKey: userSupabaseAnonKey ?? defaults.supabaseAnonKey,
    spacesPublicBase,
    spacesEndpoint,
    spacesRegion,
    spacesBucket,
    spacesAccessKey,
    spacesSecretKey,
    cloudLiveEnabled: cfg.cloudLiveEnabled === true,
    spacesWriteReady,
  };
}
