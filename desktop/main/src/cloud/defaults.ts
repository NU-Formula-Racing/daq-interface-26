import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CloudDefaults {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  spacesPublicBase: string | null;
}

const EMPTY: CloudDefaults = {
  supabaseUrl: null,
  supabaseAnonKey: null,
  spacesPublicBase: null,
};

function strField(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Read cloud-defaults.json from the given directory.
 *  Tolerates missing file / bad JSON / wrong types — anything that isn't a
 *  non-empty string for a known field becomes null. */
export function loadCloudDefaults(resourcesDir: string): CloudDefaults {
  const path = join(resourcesDir, 'cloud-defaults.json');
  if (!existsSync(path)) return { ...EMPTY };
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); }
  catch { return { ...EMPTY }; }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { ...EMPTY }; }
  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  return {
    supabaseUrl:      strField(obj.supabaseUrl),
    supabaseAnonKey:  strField(obj.supabaseAnonKey),
    spacesPublicBase: strField(obj.spacesPublicBase),
  };
}
