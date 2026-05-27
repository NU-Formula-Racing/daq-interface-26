import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { SupabaseFramesStore, type RpcRow } from './SupabaseFramesStore';
import { bucketFor } from './bucketFor';
import { FramesCache } from './framesCache';
import type { FetchStatus } from './useSupabaseFrames';

export interface UseSupabaseLiveReplayArgs {
  sessionId: string | null;
  signalIds: number[];
  start: string | null;
  end: string | null;
  targetBuckets?: number;
}

/**
 * Replay-style fetcher for a *live* session — same lazy/window/bucket
 * semantics as useSupabaseFrames, but calls get_live_signals_window
 * against live_readings instead of get_signals_window against sd_readings.
 *
 * Live sessions get appended to as they run, so the caller is expected to
 * periodically advance `end` to "now" if it wants to see new data. This
 * hook itself just refetches on window change.
 */
export function useSupabaseLiveReplay(args: UseSupabaseLiveReplayArgs) {
  const storeRef = useRef<SupabaseFramesStore>(new SupabaseFramesStore());
  const cacheRef = useRef<FramesCache>(new FramesCache(256));
  const store = storeRef.current;
  const cache = cacheRef.current;
  const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });

  const stateRef = useRef<{
    sessionId: string | null;
    start: string | null;
    end: string | null;
    bucketSecs: number | null;
  }>({ sessionId: null, start: null, end: null, bucketSecs: null });

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );

  const idsKey = useMemo(
    () => [...args.signalIds].sort((a, b) => a - b).join(','),
    [args.signalIds],
  );

  useEffect(() => {
    if (!args.sessionId || !args.start || !args.end || args.signalIds.length === 0) {
      setStatus({ kind: 'idle' });
      return;
    }

    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);

    const windowChanged =
      stateRef.current.sessionId !== args.sessionId ||
      stateRef.current.start !== args.start ||
      stateRef.current.end !== args.end ||
      stateRef.current.bucketSecs !== bucketSecs;

    if (windowChanged) {
      if (stateRef.current.sessionId) cache.resetSession(stateRef.current.sessionId);
      store.reset();
      stateRef.current = {
        sessionId: args.sessionId,
        start: args.start,
        end: args.end,
        bucketSecs,
      };
    }

    const toFetch = cache.missing(args.sessionId, args.signalIds, args.start, args.end, bucketSecs);
    if (toFetch.length === 0) {
      setStatus({ kind: 'ready' });
      return;
    }

    let cancelled = false;
    setStatus({ kind: 'loading' });
    supabase.rpc('get_live_signals_window', {
      p_session_id: args.sessionId,
      p_signal_ids: toFetch,
      p_start: args.start,
      p_end: args.end,
      p_bucket_secs: bucketSecs,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('get_live_signals_window failed', error);
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      store.ingest((data ?? []) as RpcRow[]);
      cache.recordFetch(args.sessionId!, toFetch, args.start!, args.end!, bucketSecs);
      setStatus({ kind: 'ready' });
    });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, args.targetBuckets, store, cache]);

  return { store, status };
}
