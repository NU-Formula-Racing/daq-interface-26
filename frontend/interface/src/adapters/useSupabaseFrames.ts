import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { SupabaseFramesStore, type RpcRow } from './SupabaseFramesStore';
import { FramesCache } from './framesCache';

export type FetchStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface UseSupabaseFramesArgs {
  sessionId: string | null;
  signalIds: number[];
  start: string | null;
  end: string | null;
  targetBuckets?: number;
}

/**
 * Lazy per-signal replay fetcher.
 *
 *  - At session-open: nothing happens until at least one signal is requested.
 *  - On signalIds change: only the newly-added IDs are fetched.
 *  - Toggling a signal OFF then ON does NOT refetch — the FramesCache
 *    remembers that (session, signal, window, bucket) tuple.
 *  - On session or window change: the FramesStore is reset and previously
 *    cached IDs for the old session are dropped.
 */
export function useSupabaseFrames(args: UseSupabaseFramesArgs) {
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
    const durationSecs = Math.max(0.001, (endMs - startMs) / 1000);
    const bucketSecs = durationSecs / (args.targetBuckets ?? 800);

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
    supabase.functions.invoke('signals-window', {
      body: {
        session_id: args.sessionId,
        signal_ids: toFetch,
        start: args.start,
        end: args.end,
        bucket_secs: bucketSecs,
      },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('signals-window failed', error);
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
