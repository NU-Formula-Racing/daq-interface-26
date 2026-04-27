import { promises as fs, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface CatalogEntry {
  name: string;
  path: string; // absolute path to a Postgres data dir
  volumeUuid?: string;
  lastUsed: string; // ISO
}

export interface Catalog {
  active: string | null;
  entries: CatalogEntry[];
}

const EMPTY: Catalog = { active: null, entries: [] };

export async function loadCatalog(filePath: string): Promise<Catalog> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return { active: null, entries: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    const active =
      typeof parsed?.active === 'string' || parsed?.active === null ? parsed.active : null;
    const entries: CatalogEntry[] = Array.isArray(parsed?.entries)
      ? parsed.entries.filter(
          (e: unknown): e is CatalogEntry =>
            !!e &&
            typeof (e as CatalogEntry).name === 'string' &&
            typeof (e as CatalogEntry).path === 'string' &&
            typeof (e as CatalogEntry).lastUsed === 'string',
        )
      : [];
    return { active, entries };
  } catch {
    return { active: null, entries: [] };
  }
}

export async function saveCatalog(filePath: string, cat: Catalog): Promise<void> {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(cat, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

export async function addEntry(
  filePath: string,
  entry: Omit<CatalogEntry, 'lastUsed'> & { lastUsed?: string },
): Promise<Catalog> {
  const cat = await loadCatalog(filePath);
  const lastUsed = entry.lastUsed ?? new Date().toISOString();
  const next: CatalogEntry = {
    name: entry.name,
    path: entry.path,
    lastUsed,
    ...(entry.volumeUuid !== undefined ? { volumeUuid: entry.volumeUuid } : {}),
  };
  const filtered = cat.entries.filter((e) => e.path !== entry.path);
  filtered.push(next);
  const updated: Catalog = { active: cat.active, entries: filtered };
  await saveCatalog(filePath, updated);
  return updated;
}

export async function switchActive(filePath: string, path: string): Promise<Catalog> {
  const cat = await loadCatalog(filePath);
  const idx = cat.entries.findIndex((e) => e.path === path);
  if (idx === -1) {
    throw new Error('path not in catalog: ' + path);
  }
  const now = new Date().toISOString();
  const entries = cat.entries.map((e, i) => (i === idx ? { ...e, lastUsed: now } : e));
  const updated: Catalog = { active: path, entries };
  await saveCatalog(filePath, updated);
  return updated;
}

export async function removeEntry(filePath: string, path: string): Promise<Catalog> {
  const cat = await loadCatalog(filePath);
  const entries = cat.entries.filter((e) => e.path !== path);
  const active = cat.active === path ? null : cat.active;
  const updated: Catalog = { active, entries };
  await saveCatalog(filePath, updated);
  return updated;
}
