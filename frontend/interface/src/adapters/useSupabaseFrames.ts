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

export function useSupabaseFrames(args: UseSupabaseFramesArgs) {
  const storeRef = useRef<SupabaseFramesStore>(new SupabaseFramesStore());
  const store = storeRef.current;
  const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });

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
    let cancelled = false;
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);

    store.reset();
    setStatus({ kind: 'loading' });
    supabase.rpc('get_signals_window', {
      p_session_id: args.sessionId,
      p_signal_ids: args.signalIds,
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
      setStatus({ kind: 'ready' });
    });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, args.targetBuckets, store]);

  return { store, status };
}
