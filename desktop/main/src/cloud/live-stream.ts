/**
 * Live frame streamer: pushes batches of `rt_readings` into Supabase as the
 * parser emits them. Best-effort and non-blocking — failures never affect
 * the local recording path. Supabase truncates `rt_readings` at 5am UTC
 * via pg_cron, so this is intentionally a "cool factor" live view, not a
 * durable archive.
 *
 * Two translations matter:
 *   1) signal_id is local-DB-numbered; Supabase has its own ids. We upsert
 *      definitions at session_started and cache the local→cloud id map.
 *   2) The local parser emits `ts` as an ISO string already; we forward as-is.
 */
import type { EventEmitter } from 'events';
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { getAppConfig } from '../db/config.ts';

const BATCH_ROWS = 200;       // flush every N rows
const BATCH_INTERVAL_MS = 1000; // or every 1 second, whichever comes first

interface FrameRow { ts: string; signal_id: number; value: number }
interface FramesEvent { type: 'frames'; rows: FrameRow[] }
interface SessionStartedEvent { type: 'session_started'; session_id: string; source: string }
type ParserEvent = FramesEvent | SessionStartedEvent | { type: string; [k: string]: unknown };

export interface LiveStreamer {
  stop: () => Promise<void>;
}

export async function startLiveStreamer(opts: {
  parser: EventEmitter;
  pool: pg.Pool;
  /** Optional override for tests. */
  clientFactory?: (url: string, key: string) => SupabaseClient;
}): Promise<LiveStreamer | null> {
  const cfg = await getAppConfig(opts.pool);
  const enabled = cfg.cloudLiveEnabled === true;
  if (!enabled || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;

  const sb = (opts.clientFactory ?? createClient)(
    cfg.supabaseUrl as string,
    cfg.supabaseAnonKey as string,
  );

  // Cached translation: local signal_id → cloud signal_id. Refreshed at
  // each session_started.
  let idMap: Map<number, number> = new Map();
  let queue: Array<{ ts: string; signal_id: number; value: number }> = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const flush = async () => {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      await sb.from('rt_readings').insert(batch);
    } catch {
      // Best effort — we don't retry. Pile-up will be re-truncated tonight.
    }
  };

  const scheduleFlush = () => {
    if (flushTimer || stopped) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, BATCH_INTERVAL_MS);
  };

  const refreshIdMap = async () => {
    // Pull the canonical signal_definitions from cloud and map by
    // (source, signal_name) → cloud id, then merge with the local
    // signal_definitions to produce local_id → cloud_id.
    try {
      const { data: cloudDefs } = await sb.from('signal_definitions')
        .select('id, source, signal_name');
      if (!cloudDefs) return;
      const cloudByKey = new Map<string, number>();
      for (const d of cloudDefs as Array<{ id: number; source: string; signal_name: string }>) {
        cloudByKey.set(`${d.source}\0${d.signal_name}`, d.id);
      }
      const { rows: localDefs } = await opts.pool.query<{
        id: number; source: string; signal_name: string;
      }>(`SELECT id, source, signal_name FROM signal_definitions`);
      const next = new Map<number, number>();
      for (const l of localDefs) {
        const cloudId = cloudByKey.get(`${l.source}\0${l.signal_name}`);
        if (typeof cloudId === 'number') next.set(l.id, cloudId);
      }
      idMap = next;
    } catch {
      // Leave stale map in place; nothing else to do.
    }
  };

  const onEvent = (ev: ParserEvent) => {
    if (stopped) return;
    if (ev.type === 'session_started') {
      void refreshIdMap();
      return;
    }
    if (ev.type !== 'frames') return;
    const rows = (ev as FramesEvent).rows;
    for (const r of rows) {
      const cloudId = idMap.get(r.signal_id);
      if (typeof cloudId !== 'number') continue;
      queue.push({ ts: r.ts, signal_id: cloudId, value: r.value });
    }
    if (queue.length >= BATCH_ROWS) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      void flush();
    } else {
      scheduleFlush();
    }
  };

  opts.parser.on('event', onEvent);

  // Warm the id map immediately so frames emitted before the first
  // session_started have a chance of being translated.
  await refreshIdMap();

  return {
    async stop() {
      stopped = true;
      opts.parser.off('event', onEvent);
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      await flush();
    },
  };
}
