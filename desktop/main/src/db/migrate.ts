import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Client } from 'pg';

export async function runMigrations(
  client: Client,
  migrationsDir: string
): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: applied } = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations'
  );
  const appliedSet = new Set(applied.map((r) => r.version));

  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (appliedSet.has(version)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
      await client.query('COMMIT');
      newlyApplied.push(version);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${file} failed: ${(err as Error).message}`
      );
    }
  }
  return newlyApplied;
}
