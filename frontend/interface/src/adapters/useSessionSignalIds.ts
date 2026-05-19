import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface UseSessionSignalIdsResult {
  ids: Set<number>;
  status: Status;
  error: string | null;
}

/**
 * Layer 2: signal IDs that have at least one row in the given session.
 * One cheap RPC, exposed as a Set for O(1) sidebar membership checks.
 * Caller resolves names/units via the Layer-1 catalog.
 */
export function useSessionSignalIds(sessionId: string | null): UseSessionSignalIdsResult {
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
    supabase.rpc('get_session_signal_ids', { p_session_id: sessionId })
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
