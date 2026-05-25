import type pg from 'pg';
import { streamNdjsonGz } from './ndjson.ts';

export interface DiffResult {
  localOnly: string[];
  backupOnly: string[];
  both: string[];
}

interface SessionRow { id: string }

export async function computeDiff(opts: {
  pool: pg.Pool;
  sessionsNdjsonPath: string;
}): Promise<DiffResult> {
  const { rows } = await opts.pool.query<{ id: string }>(
    'SELECT id FROM sessions',
  );
  const local = new Set(rows.map((r) => r.id));
  const backup = new Set<string>();
  for await (const row of streamNdjsonGz<SessionRow>(opts.sessionsNdjsonPath)) {
    if (row.id) backup.add(row.id);
  }
  const localOnly: string[] = [];
  const backupOnly: string[] = [];
  const both: string[] = [];
  for (const id of local) (backup.has(id) ? both : localOnly).push(id);
  for (const id of backup) if (!local.has(id)) backupOnly.push(id);
  localOnly.sort();
  backupOnly.sort();
  both.sort();
  return { localOnly, backupOnly, both };
}

async function main(): Promise<void> {
  const { Pool } = await import('pg');
  const { resolve } = await import('node:path');

  const connStr = process.env.NFR_DB_URL ?? process.argv[2];
  if (!connStr) {
    console.error('usage: tsx compare-backup-vs-local.ts <connection-string>');
    console.error('   or: NFR_DB_URL=<...> tsx compare-backup-vs-local.ts');
    process.exit(2);
  }
  const sessionsNdjsonPath = resolve('backups/supabase-pre-parquet/sessions.ndjson.gz');

  const pool = new Pool({ connectionString: connStr });
  try {
    const diff = await computeDiff({ pool, sessionsNdjsonPath });
    const fmt = (ids: string[]) =>
      ids.length === 0 ? '  (none)' : ids.map((id) => `  ${id}`).join('\n');
    console.log(`Local only (will upload):           ${diff.localOnly.length}`);
    console.log(fmt(diff.localOnly));
    console.log(`Both local and backup (local wins): ${diff.both.length}`);
    console.log(fmt(diff.both));
    console.log(`Backup only (run restore!):         ${diff.backupOnly.length}`);
    console.log(fmt(diff.backupOnly));
  } finally {
    await pool.end();
  }
}

// Run main() only when invoked as a script (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
