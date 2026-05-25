import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCloudDefaults } from './defaults.ts';

describe('loadCloudDefaults', () => {
  it('returns all-null when the file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    const d = loadCloudDefaults(dir);
    expect(d).toEqual({
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
  });

  it('parses present values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    await writeFile(join(dir, 'cloud-defaults.json'), JSON.stringify({
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'k',
      spacesPublicBase: 'https://b.r.digitaloceanspaces.com',
    }));
    const d = loadCloudDefaults(dir);
    expect(d.supabaseUrl).toBe('https://x.supabase.co');
    expect(d.supabaseAnonKey).toBe('k');
    expect(d.spacesPublicBase).toBe('https://b.r.digitaloceanspaces.com');
  });

  it('returns nulls for fields that are wrong type or empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    await writeFile(join(dir, 'cloud-defaults.json'), JSON.stringify({
      supabaseUrl: '', supabaseAnonKey: 42, spacesPublicBase: null,
    }));
    const d = loadCloudDefaults(dir);
    expect(d).toEqual({
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
  });

  it('returns all-null on malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cd-'));
    await writeFile(join(dir, 'cloud-defaults.json'), 'not json');
    const d = loadCloudDefaults(dir);
    expect(d).toEqual({
      supabaseUrl: null, supabaseAnonKey: null, spacesPublicBase: null,
    });
  });
});
