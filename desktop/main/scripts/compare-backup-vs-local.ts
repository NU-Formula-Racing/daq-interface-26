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
