import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { SupabaseFramesStore, type RpcRow } from './SupabaseFramesStore';
import { bucketFor } from './bucketFor';

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
 * Incremental replay fetcher:
 *   - On (session | start | end) change → reset store, fetch ALL current signals.
 *   - On signalIds change only → fetch ONLY newly-added signals; leave the
 *     ones already in the store untouched. Removed signals stay in the store
 *     as harmless ballast.
 */
export function useSupabaseFrames(args: UseSupabaseFramesArgs) {
  const storeRef = useRef<SupabaseFramesStore>(new SupabaseFramesStore());
  const store = storeRef.current;
  const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });

  // What's currently materialized in the store for the current session window.
  const stateRef = useRef<{
    sessionId: string | null;
    start: string | null;
    end: string | null;
    fetched: Set<number>;
  }>({ sessionId: null, start: null, end: null, fetched: new Set() });

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

    const sessionChanged =
      stateRef.current.sessionId !== args.sessionId ||
      stateRef.current.start !== args.start ||
      stateRef.current.end !== args.end;

    let toFetch: number[];
    if (sessionChanged) {
      store.reset();
      stateRef.current = {
        sessionId: args.sessionId,
        start: args.start,
        end: args.end,
        fetched: new Set(),
      };
      toFetch = args.signalIds;
    } else {
      toFetch = args.signalIds.filter((id) => !stateRef.current.fetched.has(id));
      if (toFetch.length === 0) {
        // Nothing new since last fetch. Idempotent — status stays as-is.
        return;
      }
    }

    let cancelled = false;
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);

    setStatus({ kind: 'loading' });
    supabase.rpc('get_signals_window', {
      p_session_id: args.sessionId,
      p_signal_ids: toFetch,
      p_start: args.start,
      p_end: args.end,
      p_bucket_secs: bucketSecs,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('get_signals_window failed', error);
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      store.ingest((data ?? []) as RpcRow[]);
      for (const id of toFetch) stateRef.current.fetched.add(id);
      setStatus({ kind: 'ready' });
    });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, args.targetBuckets, store]);

  return { store, status };
}
