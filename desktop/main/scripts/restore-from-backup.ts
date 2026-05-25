import type pg from 'pg';
import { join } from 'node:path';
import { streamNdjsonGz } from './ndjson.ts';

interface SignalDefBackup {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  description?: string | null;
}

interface SessionBackup {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  source: string;
  source_file: string | null;
  source_file_hash: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
}

interface ReadingBackup {
  ts: string;
  value: number;
  signal_id: number;
  session_id: string;
}

export interface RestoreSummary { sessions: number; rows: number }

const PARTITION_NAMES = [
  'sd_readings_2026_03.ndjson.gz',
  'sd_readings_2026_04.ndjson.gz',
  'sd_readings_2026_05.ndjson.gz',
  'sd_readings_2026_06.ndjson.gz',
  'sd_readings_2026_07.ndjson.gz',
  'sd_readings_2026_08.ndjson.gz',
  'sd_readings_2026_09.ndjson.gz',
  'sd_readings_2026_10.ndjson.gz',
  'sd_readings_2026_11.ndjson.gz',
  'sd_readings_2026_12.ndjson.gz',
];

export async function restoreSessions(opts: {
  pool: pg.Pool;
  backupDir: string;
  sessionIds: string[];
}): Promise<RestoreSummary> {
  const wanted = new Set(opts.sessionIds);

  // 1. Build cloud-id -> local-id map for signal_definitions, upserting as needed.
  const cloudToLocal = new Map<number, number>();
  for await (const def of streamNdjsonGz<SignalDefBackup>(
    join(opts.backupDir, 'signal_definitions.ndjson.gz'),
  )) {
    const { rows } = await opts.pool.query<{ id: number }>(
      `INSERT INTO signal_definitions (source, signal_name, unit, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, signal_name) DO UPDATE
         SET unit = COALESCE(signal_definitions.unit, EXCLUDED.unit),
             description = COALESCE(signal_definitions.description, EXCLUDED.description)
       RETURNING id`,
      [def.source, def.signal_name, def.unit, def.description ?? null],
    );
    cloudToLocal.set(def.id, rows[0].id);
  }

  // 2. For each wanted session, insert + restore rows in one transaction.
  let sessionsRestored = 0;
  let rowsRestored = 0;
  const sessionsByUuid = new Map<string, SessionBackup>();
  for await (const s of streamNdjsonGz<SessionBackup>(
    join(opts.backupDir, 'sessions.ndjson.gz'),
  )) {
    if (wanted.has(s.id)) sessionsByUuid.set(s.id, s);
  }

  for (const id of opts.sessionIds) {
    const s = sessionsByUuid.get(id);
    if (!s) continue;

    const client = await opts.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sessions (id, date, started_at, ended_at, source, source_file,
                               source_file_hash, track, driver, car, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.date, s.started_at, s.ended_at, s.source, s.source_file,
         s.source_file_hash, s.track, s.driver, s.car, s.notes],
      );

      let perSession = 0;
      for (const partName of PARTITION_NAMES) {
        for await (const r of streamNdjsonGz<ReadingBackup>(
          join(opts.backupDir, partName),
        )) {
          if (r.session_id !== id) continue;
          const localSigId = cloudToLocal.get(r.signal_id);
          if (typeof localSigId !== 'number') continue;
          await client.query(
            `INSERT INTO sd_readings (ts, session_id, signal_id, value)
             VALUES ($1, $2, $3, $4)`,
            [r.ts, id, localSigId, r.value],
          );
          perSession++;
        }
      }
      await client.query('COMMIT');
      sessionsRestored++;
      rowsRestored += perSession;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { sessions: sessionsRestored, rows: rowsRestored };
}
