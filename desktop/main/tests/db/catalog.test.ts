import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadCatalog,
  saveCatalog,
  addEntry,
  switchActive,
  removeEntry,
} from '../../src/db/catalog.ts';

function freshCatalogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cat-'));
  return join(dir, 'nfr-catalog.json');
}

describe('catalog (json file)', () => {
  it('loadCatalog returns empty defaults when file does not exist', async () => {
    const filePath = freshCatalogPath();
    const cat = await loadCatalog(filePath);
    expect(cat).toEqual({ active: null, entries: [] });
  });

  it('addEntry inserts new and dedupes by path on a second call', async () => {
    const filePath = freshCatalogPath();
    await addEntry(filePath, { name: 'one', path: '/data/a' });
    await addEntry(filePath, { name: 'two', path: '/data/b' });
    let cat = await loadCatalog(filePath);
    expect(cat.entries.length).toBe(2);

    // Re-add same path with different name; should replace, not duplicate.
    cat = await addEntry(filePath, { name: 'one-renamed', path: '/data/a' });
    expect(cat.entries.length).toBe(2);
    const a = cat.entries.find((e) => e.path === '/data/a');
    expect(a?.name).toBe('one-renamed');
  });

  it('switchActive sets active when path exists', async () => {
    const filePath = freshCatalogPath();
    await addEntry(filePath, { name: 'one', path: '/data/a' });
    const cat = await switchActive(filePath, '/data/a');
    expect(cat.active).toBe('/data/a');
  });

  it('switchActive throws for an unknown path', async () => {
    const filePath = freshCatalogPath();
    await addEntry(filePath, { name: 'one', path: '/data/a' });
    await expect(switchActive(filePath, '/data/missing')).rejects.toThrow(/not in catalog/i);
  });

  it('removeEntry removes the entry and clears active when it was active', async () => {
    const filePath = freshCatalogPath();
    await addEntry(filePath, { name: 'one', path: '/data/a' });
    await addEntry(filePath, { name: 'two', path: '/data/b' });
    await switchActive(filePath, '/data/a');
    const cat = await removeEntry(filePath, '/data/a');
    expect(cat.entries.find((e) => e.path === '/data/a')).toBeUndefined();
    expect(cat.active).toBeNull();
    expect(cat.entries.length).toBe(1);
  });

  it('saveCatalog then loadCatalog round-trips identically', async () => {
    const filePath = freshCatalogPath();
    const original = {
      active: '/data/a',
      entries: [
        { name: 'one', path: '/data/a', volumeUuid: 'uuid-1', lastUsed: '2026-04-26T00:00:00.000Z' },
        { name: 'two', path: '/data/b', lastUsed: '2026-04-25T00:00:00.000Z' },
      ],
    };
    await saveCatalog(filePath, original);
    const loaded = await loadCatalog(filePath);
    expect(loaded).toEqual(original);
  });
});
