import type pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SignalDef {
  source: string;
  signal_name: string;
  unit: string | null;
  description: string | null;
}

export interface SessionToPush {
  id: string;
  row: Record<string, unknown>;
  /** Signal definitions referenced by this session's readings. */
  signals: Array<SignalDef & { local_id: number }>;
  readings: Array<{ ts: string; signal_id: number; value: number }>;
}

export interface LocalReader {
  unsynced: () => Promise<SessionToPush[]>;
  markSynced: (sessionId: string) => Promise<void>;
}

export interface CloudPusher {
  /** Upsert signal defs by (source, signal_name); return local_id → cloud_id. */
  pushSignals: (defs: Array<SignalDef & { local_id: number }>) => Promise<Map<number, number>>;
  pushSession: (sessionId: string, row: Record<string, unknown>) => Promise<void>;
  pushReadings: (
    sessionId: string,
    readings: SessionToPush['readings'],
  ) => Promise<void>;
}

export interface PushResult {
  pushed: number;
  failed: number;
  errors: Array<{ sessionId: string; message: string }>;
}

export async function pushSessionsToCloud(
  reader: LocalReader,
  pusher: CloudPusher,
): Promise<PushResult> {
  const sessions = await reader.unsynced();
  let pushed = 0;
  let failed = 0;
  const errors: Array<{ sessionId: string; message: string }> = [];
  for (const s of sessions) {
    try {
      // Upsert signal defs first so we can translate the readings'
      // local signal_ids into whatever ids the cloud uses.
      const idMap = s.signals.length > 0 ? await pusher.pushSignals(s.signals) : new Map();
      const translated = s.readings.map((r) => ({
        ts: r.ts,
        signal_id: idMap.get(r.signal_id) ?? r.signal_id,
        value: r.value,
      }));
      await pusher.pushSession(s.id, s.row);
      await pusher.pushReadings(s.id, translated);
      await reader.markSynced(s.id);
      pushed++;
    } catch (err) {
      failed++;
      errors.push({ sessionId: s.id, message: (err as Error).message });
    }
  }
  return { pushed, failed, errors };
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
        const { rows: signals } = await pool.query<{
          id: number;
          source: string;
          signal_name: string;
          unit: string | null;
          description: string | null;
        }>(`SELECT DISTINCT sd.id, sd.source, sd.signal_name, sd.unit, sd.description
            FROM signal_definitions sd
            JOIN sd_readings r ON r.signal_id = sd.id
            WHERE r.session_id = $1`,
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
          signals: signals.map((d) => ({
            local_id: d.id,
            source: d.source,
            signal_name: d.signal_name,
            unit: d.unit,
            description: d.description,
          })),
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
    async pushSignals(defs) {
      const map = new Map<number, number>();
      if (defs.length === 0) return map;
      const payload = defs.map((d) => ({
        source: d.source,
        signal_name: d.signal_name,
        unit: d.unit,
        description: d.description,
      }));
      const { data, error } = await client
        .from('signal_definitions')
        .upsert(payload, { onConflict: 'source,signal_name' })
        .select('id, source, signal_name');
      if (error) throw new Error(`signals upsert failed: ${error.message}`);
      const cloudByKey = new Map<string, number>();
      for (const r of data ?? []) {
        cloudByKey.set(`${r.source}\u0000${r.signal_name}`, r.id);
      }
      for (const d of defs) {
        const cloudId = cloudByKey.get(`${d.source}\u0000${d.signal_name}`);
        if (cloudId !== undefined) map.set(d.local_id, cloudId);
      }
      return map;
    },
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
