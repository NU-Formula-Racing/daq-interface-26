import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.ts';
import type { OverviewRow, SessionDetail } from '../api/types.ts';

export interface ReplayData {
  detail: SessionDetail | null;
  rows: OverviewRow[];
  loading: boolean;
  error: string | null;
  /** Bucket size (seconds) actually used for the overview fetch. */
  bucketSecs: number;
}

const TARGET_BUCKETS = 2000;  // points per signal across the whole session
const MIN_BUCKET_S = 0.05;    // 20 Hz upper ceiling — finer is wasteful
const MAX_BUCKET_S = 5;       // ≥ 5 s buckets only for very long replays

/** Pick a bucket size aiming for ~TARGET_BUCKETS points across the session,
 *  clamped to [MIN_BUCKET_S, MAX_BUCKET_S]. Returns a float (seconds). */
function pickBucketSecs(durationSecs: number): number {
  if (!isFinite(durationSecs) || durationSecs <= 0) return 1;
  const raw = durationSecs / TARGET_BUCKETS;
  return Math.min(MAX_BUCKET_S, Math.max(MIN_BUCKET_S, raw));
}

/**
 * Fetches session detail and the bucketed-overview series.
 *
 * Bucket selection is automatic — derived from session duration to target
 * roughly TARGET_BUCKETS points per signal — so short sessions get sub-second
 * granularity instead of being floored at 1 Hz. Passing an explicit
 * `bucketSecs` overrides the auto-pick.
 */
export function useOverview(
  sessionId: string,
  bucketSecs?: number,
): ReplayData {
  const [data, setData] = useState<ReplayData>({
    detail: null,
    rows: [],
    loading: true,
    error: null,
    bucketSecs: 1,
  });

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, error: null }));
    (async () => {
      try {
        const detail = await apiGet<SessionDetail>(`/api/sessions/${sessionId}`);
        if (cancelled) return;

        let bucket = bucketSecs;
        if (bucket === undefined) {
          const startedMs = detail.started_at ? new Date(detail.started_at).getTime() : null;
          const endedMs = detail.ended_at ? new Date(detail.ended_at).getTime() : null;
          const durationSecs = startedMs && endedMs
            ? Math.max(0, (endedMs - startedMs) / 1000)
            : 0;
          bucket = pickBucketSecs(durationSecs);
        }

        const rows = await apiGet<OverviewRow[]>(
          `/api/sessions/${sessionId}/overview`, { bucket },
        );
        if (cancelled) return;
        setData({ detail, rows, loading: false, error: null, bucketSecs: bucket });
      } catch (err) {
        if (cancelled) return;
        setData({ detail: null, rows: [], loading: false, error: String(err), bucketSecs: 1 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, bucketSecs]);

  return data;
}
