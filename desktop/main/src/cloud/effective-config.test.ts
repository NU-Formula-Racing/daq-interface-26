import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getEffectiveCloudConfig } from './effective-config.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });

beforeAll(async () => {
  await pool.query(`UPDATE app_config SET data = '{}'::jsonb WHERE id = 1`);
});
afterAll(async () => {
  await pool.query(`UPDATE app_config SET data = '{}'::jsonb WHERE id = 1`);
  await pool.end();
});

describe('getEffectiveCloudConfig', () => {
  it('falls back to bundled defaults when user has set nothing', async () => {
    const eff = await getEffectiveCloudConfig(pool, {
      supabaseUrl: 'https://default.supabase.co',
      supabaseAnonKey: 'default-anon',
      spacesPublicBase: 'https://default.r.digitaloceanspaces.com',
    });
    expect(eff.supabaseUrl).toBe('https://default.supabase.co');
    expect(eff.supabaseAnonKey).toBe('default-anon');
    expect(eff.spacesPublicBase).toBe('https://default.r.digitaloceanspaces.com');
    expect(eff.spacesAccessKey).toBeNull();
    expect(eff.spacesSecretKey).toBeNull();
  });

  it('user-set values override bundled defaults', async () => {
    await pool.query(
      `UPDATE app_config SET data = $1::jsonb WHERE id = 1`,
      [JSON.stringify({
        supabaseUrl: 'https://override.supabase.co',
        spacesAccessKey: 'DO00abc',
        spacesSecretKey: 'secret',
        spacesEndpoint: 'https://sfo3.digitaloceanspaces.com',
        spacesRegion: 'sfo3',
        spacesBucket: 'custom-bucket',
      })],
    );
    const eff = await getEffectiveCloudConfig(pool, {
      supabaseUrl: 'https://default.supabase.co',
      supabaseAnonKey: 'default-anon',
      spacesPublicBase: 'https://default.r.digitaloceanspaces.com',
    });
    expect(eff.supabaseUrl).toBe('https://override.supabase.co');
    // anon key still bundled (user didn't set it)
    expect(eff.supabaseAnonKey).toBe('default-anon');
    // public base derived from user's endpoint/region/bucket, NOT bundled
    expect(eff.spacesPublicBase).toBe('https://custom-bucket.sfo3.digitaloceanspaces.com');
    expect(eff.spacesAccessKey).toBe('DO00abc');
    expect(eff.spacesSecretKey).toBe('secret');
  });

  it('returns nulls when neither user nor bundled has the value', async () => {
    await pool.query(`UPDATE app_config SET data = '{}'::jsonb WHERE id = 1`);
    const eff = await getEffectiveCloudConfig(pool, {
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
    expect(eff.supabaseUrl).toBeNull();
    expect(eff.supabaseAnonKey).toBeNull();
    expect(eff.spacesPublicBase).toBeNull();
  });
});
