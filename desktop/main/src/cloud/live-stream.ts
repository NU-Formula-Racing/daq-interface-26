/**
 * Live cloud sync: replicates a live (basestation) session to Supabase on a
 * 2 s cadence. Reads from the parser event stream and writes:
 *
 *   - one row into `live_sessions` on session_started / updated on session_ended
 *   - batches of rows into `live_readings` every 2 s (or BATCH_ROWS, whichever
 *     comes first)
 *
 * Retention is managed cloud-side by a pg_cron job (12 h rolling). On the local
 * side, a brand-new live session wipes any prior local live session — only one
 * lives in the desktop DB at a time, by design.
 *
 * Two translations matter:
 *   1) signal_id is local-DB-numbered; Supabase has its own ids. We refresh
 *      a local→cloud map at each session_started and skip rows whose signal
 *      isn't yet in the cloud catalog.
 *   2) `ts` is already an ISO string from the parser; forward as-is.
 *
 * Failure mode: best-effort. Network/DB errors drop the affected batch and
 * never block the local recording path. The desktop UI keeps showing live
 * data regardless of cloud sync state.
 */
import type { EventEmitter } from 'events';
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hostname } from 'os';
import { createClient } from './supabase-client.ts';
import { getAppConfig } from '../db/config.ts';

const BATCH_ROWS = 500;          // flush early once the buffer hits this
const BATCH_INTERVAL_MS = 2_000; // … otherwise every 2 s

interface FrameRow { ts: string; signal_id: number; value: number }
interface FramesEvent { type: 'frames'; rows: FrameRow[] }
interface SessionStartedEvent { type: 'session_started'; session_id: string; source: string }
interface SessionEndedEvent { type: 'session_ended'; session_id: string }
type ParserEvent =
  | FramesEvent
  | SessionStartedEvent
  | SessionEndedEvent
  | { type: string; [k: string]: unknown };

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

  let idMap = new Map<number, number>();
  let queue: Array<{ ts: string; session_id: string; signal_id: number; value: number }> = [];
  let currentLiveSessionId: string | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const flush = async () => {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      await sb.from('live_readings').insert(batch);
    } catch {
      // Best effort — drop the batch, the retention sweep will clean up anyway.
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
      // Leave stale map in place.
    }
  };

  // On a fresh live session: drop any prior local live session (and its rows
  // via cascade), then announce the new one to Supabase. Local is single-slot
  // by design — only one live session ever exists at a time.
  const onLiveSessionStarted = async (sessionId: string) => {
    currentLiveSessionId = sessionId;
    try {
      await opts.pool.query(
        `DELETE FROM sessions WHERE source = 'live' AND id <> $1`,
        [sessionId],
      );
    } catch (err) {
      console.error('live-sync: failed to wipe prior local live session:', (err as Error).message);
    }
    // Refresh signal id mapping in case the catalog grew.
    await refreshIdMap();
    try {
      await sb.from('live_sessions').insert({
        id: sessionId,
        started_at: new Date().toISOString(),
        machine: hostname(),
      });
    } catch (err) {
      console.error('live-sync: cloud live_sessions insert failed:', (err as Error).message);
    }
  };

  const onLiveSessionEnded = async (sessionId: string) => {
    await flush();
    try {
      await sb.from('live_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', sessionId);
    } catch (err) {
      console.error('live-sync: cloud live_sessions update failed:', (err as Error).message);
    }
    if (currentLiveSessionId === sessionId) currentLiveSessionId = null;
  };

  const onEvent = (ev: ParserEvent) => {
    if (stopped) return;
    if (ev.type === 'session_started') {
      const s = ev as SessionStartedEvent;
      if (s.source === 'live') void onLiveSessionStarted(s.session_id);
      return;
    }
    if (ev.type === 'session_ended') {
      const s = ev as SessionEndedEvent;
      if (currentLiveSessionId && s.session_id === currentLiveSessionId) {
        void onLiveSessionEnded(s.session_id);
      }
      return;
    }
    if (ev.type !== 'frames') return;
    if (!currentLiveSessionId) return; // ignore frames outside a live session
    const rows = (ev as FramesEvent).rows;
    const sid = currentLiveSessionId;
    for (const r of rows) {
      const cloudId = idMap.get(r.signal_id);
      if (typeof cloudId !== 'number') continue;
      queue.push({ ts: r.ts, session_id: sid, signal_id: cloudId, value: r.value });
    }
    if (queue.length >= BATCH_ROWS) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      void flush();
    } else {
      scheduleFlush();
    }
  };

  opts.parser.on('event', onEvent);

  // Warm the id map immediately — covers the case where a session was already
  // running when the streamer started.
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
