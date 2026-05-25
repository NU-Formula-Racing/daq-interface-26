import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.ts';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface UseSessionSignalIdsResult {
  ids: Set<number>;
  status: Status;
  error: string | null;
}

/** Layer 2: signal IDs that have data in the given session. One cheap RPC. */
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
    apiGet<number[]>(`/api/sessions/${sessionId}/signal-ids`)
      .then((arr) => {
        if (cancelled) return;
        setIds(new Set(arr));
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(String(err));
        setIds(new Set());
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  return { ids, status, error };
}
