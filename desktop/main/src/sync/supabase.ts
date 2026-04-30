import type pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SessionToPush {
  id: string;
  row: Record<string, unknown>;
  readings: Array<{ ts: string; signal_id: number; value: number }>;
}

export interface LocalReader {
  unsynced: () => Promise<SessionToPush[]>;
  markSynced: (sessionId: string) => Promise<void>;
}

export interface CloudPusher {
  pushSession: (sessionId: string, row: Record<string, unknown>) => Promise<void>;
  pushReadings: (
    sessionId: string,
    readings: SessionToPush['readings'],
  ) => Promise<void>;
}

export interface PushResult {
  pushed: number;
  failed: number;
}

export async function pushSessionsToCloud(
  reader: LocalReader,
  pusher: CloudPusher,
): Promise<PushResult> {
  const sessions = await reader.unsynced();
  let pushed = 0;
  let failed = 0;
  for (const s of sessions) {
    try {
      await pusher.pushSession(s.id, s.row);
      await pusher.pushReadings(s.id, s.readings);
      await reader.markSynced(s.id);
      pushed++;
    } catch {
      failed++;
    }
  }
  return { pushed, failed };
}

export function localReaderFromPool(pool: pg.Pool): LocalReader {
  return {
    async unsynced() {
      const { rows: sessions } = await pool.query<{
        id: string;
        date: string;
        started_at: Date;
        ended_at: Date;
        track: string | null;
        driver: string | null;
        car: string | null;
        notes: string | null;
        source: string;
        source_file: string | null;
      }>(`SELECT id, date::text, started_at, ended_at, track, driver, car,
                 notes, source, source_file
          FROM sessions
          WHERE synced_at IS NULL AND ended_at IS NOT NULL
          ORDER BY started_at ASC`);

      const out: SessionToPush[] = [];
      for (const s of sessions) {
        const { rows: readings } = await pool.query<{
          ts: Date;
          signal_id: number;
          value: string;
        }>(`SELECT ts, signal_id, value FROM sd_readings WHERE session_id = $1 ORDER BY ts`,
          [s.id]);
        out.push({
          id: s.id,
          row: {
            date: s.date,
            started_at: s.started_at.toISOString(),
            ended_at: s.ended_at.toISOString(),
            track: s.track,
            driver: s.driver,
            car: s.car,
            notes: s.notes,
            source: s.source,
            source_file: s.source_file,
          },
          readings: readings.map((r) => ({
            ts: r.ts.toISOString(),
            signal_id: r.signal_id,
            value: Number(r.value),
          })),
        });
      }
      return out;
    },
    async markSynced(id) {
      await pool.query(`UPDATE sessions SET synced_at = now() WHERE id = $1`, [id]);
    },
  };
}

export function supabaseCloudPusher(
  url: string,
  anonKey: string,
  clientFactory: (u: string, k: string) => SupabaseClient = createClient,
): CloudPusher {
  const client = clientFactory(url, anonKey);
  return {
    async pushSession(sessionId, row) {
      const payload = { id: sessionId, ...row };
      const { error } = await client.from('sessions').upsert(payload);
      if (error) throw new Error(`session upsert failed: ${error.message}`);
    },
    async pushReadings(sessionId, readings) {
      if (readings.length === 0) return;
      const rows = readings.map((r) => ({
        session_id: sessionId,
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value,
      }));
      const CHUNK = 500;
      // Use upsert with ignoreDuplicates so retries after a partial failure
      // don't create duplicate readings. The cloud has a UNIQUE constraint
      // on (session_id, ts, signal_id); ON CONFLICT DO NOTHING is the
      // idempotent behavior we want.
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await client
          .from('sd_readings')
          .upsert(rows.slice(i, i + CHUNK), {
            onConflict: 'session_id,ts,signal_id',
            ignoreDuplicates: true,
          });
        if (error) throw new Error(`readings upsert failed: ${error.message}`);
      }
    },
  };
}
