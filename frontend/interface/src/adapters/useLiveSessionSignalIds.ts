import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Status } from './useSessionSignalIds';

/**
 * `live_readings` flavour of useSessionSignalIds — drives the sidebar's
 * ACTIVE filter for live sessions.
 */
export function useLiveSessionSignalIds(sessionId: string | null) {
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setIds(new Set());
      setStatus('idle');
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    supabase.rpc('get_live_session_signal_ids', { p_session_id: sessionId })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) {
          setStatus('error');
          setError(rpcErr.message);
          setIds(new Set());
          return;
        }
        const next = new Set<number>();
        for (const r of (data ?? []) as Array<{ signal_id: number }>) next.add(r.signal_id);
        setIds(next);
        setStatus('ready');
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  return { ids, status, error };
}
