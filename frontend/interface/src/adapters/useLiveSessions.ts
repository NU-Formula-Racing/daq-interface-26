import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface LiveSessionItem {
  id: string;
  started_at: string;
  ended_at: string | null;
  machine: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
  /** Derived: minutes since started_at, capped at 12 h (the retention window). */
  age_minutes: number;
}

/**
 * Lists live sessions over the rolling 12 h retention window. Cheap query,
 * polls every `refreshMs` so the picker can reflect new sessions or
 * status changes (LIVE → ENDED) without a manual reload.
 */
export function useLiveSessions(refreshMs = 15_000) {
  const [sessions, setSessions] = useState<LiveSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
      supabase.from('live_sessions')
        .select('id, started_at, ended_at, machine, track, driver, car, notes')
        .gt('started_at', since)
        .order('started_at', { ascending: false })
        .then(({ data, error: err }) => {
          if (cancelled) return;
          if (err) { setError(new Error(err.message)); setLoading(false); return; }
          const now = Date.now();
          const next: LiveSessionItem[] = (data ?? []).map((r) => ({
            id: r.id as string,
            started_at: r.started_at as string,
            ended_at: (r.ended_at as string | null) ?? null,
            machine: (r.machine as string | null) ?? null,
            track: (r.track as string | null) ?? null,
            driver: (r.driver as string | null) ?? null,
            car: (r.car as string | null) ?? null,
            notes: (r.notes as string | null) ?? null,
            age_minutes: Math.max(0, Math.round((now - Date.parse(r.started_at as string)) / 60000)),
          }));
          setSessions(next);
          setError(null);
          setLoading(false);
        });
    };
    load();
    const iv = setInterval(load, refreshMs);
    return () => { cancelled = true; clearInterval(iv); };
  }, [refreshMs]);

  return { sessions, loading, error };
}
