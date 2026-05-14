import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { SupabaseFramesStore, type RpcRow } from './SupabaseFramesStore';
import type { FetchStatus } from './useSupabaseFrames';

const BATCH_INTERVAL_MS = 150;
// Soft cap on frames retained per signal to keep the browser snappy.
// Roughly: at 100 Hz, 5 minutes = 30000 frames. We're more conservative.
const MAX_FRAMES_PER_SIGNAL = 5000;

interface RtRow {
  ts: string;
  signal_id: number;
  value: number;
}

/**
 * Live frames adapter — subscribes to Supabase Realtime INSERT events on
 * rt_readings and pushes them into a FramesStore. Rows are batched on a
 * short timer so React renders don't fire on every single insert.
 */
export function useSupabaseLiveFrames(enabled = true) {
  const storeRef = useRef<SupabaseFramesStore>(new SupabaseFramesStore());
  const store = storeRef.current;
  const queueRef = useRef<RpcRow[]>([]);
  const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );

  useEffect(() => {
    if (!enabled) {
      setStatus({ kind: 'idle' });
      return;
    }
    setStatus({ kind: 'loading' });
    store.reset();

    const channel = supabase
      .channel('rt_readings_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rt_readings' },
        (payload) => {
          const r = payload.new as RtRow;
          // Reshape Realtime row → RpcRow shape; live data has no buckets,
          // so min/max are just the value itself.
          queueRef.current.push({
            ts: r.ts,
            signal_id: r.signal_id,
            value_avg: r.value,
            value_min: r.value,
            value_max: r.value,
            sample_n: 1,
          });
        },
      )
      .subscribe((subStatus) => {
        if (subStatus === 'SUBSCRIBED') setStatus({ kind: 'ready' });
        else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT') {
          setStatus({ kind: 'error', message: subStatus });
        }
      });

    const flush = setInterval(() => {
      if (queueRef.current.length === 0) return;
      const batch = queueRef.current;
      queueRef.current = [];
      store.ingest(batch);
      // Trim ring buffers to keep memory bounded.
      store.trimPerSignal(MAX_FRAMES_PER_SIGNAL);
    }, BATCH_INTERVAL_MS);

    return () => {
      clearInterval(flush);
      supabase.removeChannel(channel);
    };
  }, [enabled, store]);

  return { store, status };
}
