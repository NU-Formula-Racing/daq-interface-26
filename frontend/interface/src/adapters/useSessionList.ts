import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface SessionListItem {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number;
  driver: string | null;
  car: string | null;
  session_number: number | null;
  source: string | null;
}

export function useSessionList(limit = 50) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.rpc('list_sessions', { p_limit: limit })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) { setError(new Error(rpcErr.message)); return; }
        setSessions((data ?? []) as SessionListItem[]);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [limit]);

  return { sessions, loading, error };
}
