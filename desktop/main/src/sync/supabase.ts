import type pg from 'pg';
import WebSocket from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Electron bundles Node 20, which has no global WebSocket. Supabase-js v2 throws
// at realtime init if one isn't present, even though sync only uses REST.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

export interface SignalDef {
  source: string;
  signal_name: string;
  unit: string | null;
  description: string | null;
}

export interface Reading {
  ts: string;
  signal_id: number;
  value: number;
}

export interface SessionHeader {
  id: string;
  row: Record<string, unknown>;
  /** Signal definitions referenced by this session's readings. */
  signals: Array<SignalDef & { local_id: number }>;
}

export interface LocalReader {
  /** Lightweight: session metadata + signal defs, no readings. */
  unsyncedHeaders: () => Promise<SessionHeader[]>;
  /** Streams readings for a session in bounded batches. */
  readingsBatches: (sessionId: string) => AsyncIterable<Reading[]>;
  markSynced: (sessionId: string) => Promise<void>;
}

export interface CloudPusher {
  /** Upsert signal defs by (source, signal_name); return local_id → cloud_id. */
  pushSignals: (defs: Array<SignalDef & { local_id: number }>) => Promise<Map<number, number>>;
  /**
   * Upsert the session row. If the row carries a `source_file_hash`, the cloud
   * dedups on that hash — returns the existing cloud session id if found,
   * otherwise the inserted id (which equals the local id).
   */
  pushSession: (sessionId: string, row: Record<string, unknown>) => Promise<string>;
  pushReadings: (sessionId: string, readings: Reading[]) => Promise<void>;
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
  const headers = await reader.unsyncedHeaders();
  let pushed = 0;
  let failed = 0;
  const errors: Array<{ sessionId: string; message: string }> = [];
  for (const s of headers) {
    try {
      // Upsert signal defs first so we can translate the readings'
      // local signal_ids into whatever ids the cloud uses.
      const idMap = s.signals.length > 0 ? await pusher.pushSignals(s.signals) : new Map();
      // pushSession returns the cloud session id. If the row had a
      // source_file_hash that matches an existing cloud session (re-import of
      // the same .bin from another machine), the returned id will be that
      // existing cloud id and pushReadings will dedup against its rows.
      const cloudSessionId = await pusher.pushSession(s.id, s.row);
      // Stream readings: bounded memory regardless of session size.
      for await (const batch of reader.readingsBatches(s.id)) {
        const translated = batch.map((r) => ({
          ts: r.ts,
          signal_id: idMap.get(r.signal_id) ?? r.signal_id,
          value: r.value,
        }));
        await pusher.pushReadings(cloudSessionId, translated);
      }
      await reader.markSynced(s.id);
      pushed++;
    } catch (err) {
      failed++;
      errors.push({ sessionId: s.id, message: (err as Error).message });
    }
  }
  return { pushed, failed, errors };
}

/** Batch size for streaming readings out of local pg. Keep small enough that
 * one batch (rows × ~150B) stays well under 100 MB of V8 heap. */
const READINGS_BATCH = 50_000;

interface ReadingRow {
  ts: Date;
  signal_id: number;
  value: string;
}

async function* streamReadings(pool: pg.Pool, sessionId: string): AsyncGenerator<Reading[]> {
  // Keyset pagination on (ts, signal_id) — bounded memory regardless of
  // session size. The composite key is unique per session because of the
  // UNIQUE (session_id, ts, signal_id) constraint.
  let cursorTs: Date | null = null;
  let cursorSignalId = 0;
  for (;;) {
    let rows: ReadingRow[];
    if (cursorTs === null) {
      const res = await pool.query<ReadingRow>(
        `SELECT ts, signal_id, value FROM sd_readings
         WHERE session_id = $1
         ORDER BY ts, signal_id LIMIT $2`,
        [sessionId, READINGS_BATCH],
      );
      rows = res.rows;
    } else {
      const res = await pool.query<ReadingRow>(
        `SELECT ts, signal_id, value FROM sd_readings
         WHERE session_id = $1 AND (ts, signal_id) > ($2, $3)
         ORDER BY ts, signal_id LIMIT $4`,
        [sessionId, cursorTs, cursorSignalId, READINGS_BATCH],
      );
      rows = res.rows;
    }
    if (rows.length === 0) return;
    yield rows.map((r) => ({
      ts: r.ts.toISOString(),
      signal_id: r.signal_id,
      value: Number(r.value),
    }));
    const last = rows[rows.length - 1];
    cursorTs = last.ts;
    cursorSignalId = last.signal_id;
    if (rows.length < READINGS_BATCH) return;
  }
}

export function localReaderFromPool(pool: pg.Pool): LocalReader {
  return {
    async unsyncedHeaders() {
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
        source_file_hash: string | null;
      }>(`SELECT id, date::text, started_at, ended_at, track, driver, car,
                 notes, source, source_file, source_file_hash
          FROM sessions
          WHERE synced_at IS NULL AND ended_at IS NOT NULL
          ORDER BY started_at ASC`);

      const out: SessionHeader[] = [];
      for (const s of sessions) {
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
            source_file_hash: s.source_file_hash,
          },
          signals: signals.map((d) => ({
            local_id: d.id,
            source: d.source,
            signal_name: d.signal_name,
            unit: d.unit,
            description: d.description,
          })),
        });
      }
      return out;
    },
    readingsBatches(sessionId: string): AsyncIterable<Reading[]> {
      return streamReadings(pool, sessionId);
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
      // If the session carries a content hash, check the cloud first — a
      // matching row means this exact source file was already imported and
      // synced from another machine. We return that row's id and skip the
      // insert so readings dedup against its existing rows.
      const hash = typeof row.source_file_hash === 'string' ? row.source_file_hash : null;
      if (hash) {
        const { data: existing, error: selErr } = await client
          .from('sessions')
          .select('id')
          .eq('source_file_hash', hash)
          .limit(1)
          .maybeSingle();
        if (selErr) throw new Error(`session lookup failed: ${selErr.message}`);
        if (existing?.id) return existing.id as string;
      }
      const payload = { id: sessionId, ...row };
      const { error } = await client.from('sessions').upsert(payload);
      if (error) throw new Error(`session upsert failed: ${error.message}`);
      return sessionId;
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
