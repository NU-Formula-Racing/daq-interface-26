import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.ts';
import type { OverviewRow, SessionDetail } from '../api/types.ts';

export interface ReplayData {
  detail: SessionDetail | null;
  rows: OverviewRow[];
  loading: boolean;
  error: string | null;
}

export function useOverview(sessionId: string, bucketSecs = 1): ReplayData {
  const [data, setData] = useState<ReplayData>({
    detail: null,
    rows: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, error: null }));
    Promise.all([
      apiGet<SessionDetail>(`/api/sessions/${sessionId}`),
      apiGet<OverviewRow[]>(`/api/sessions/${sessionId}/overview`, { bucket: bucketSecs }),
    ])
      .then(([detail, rows]) => {
        if (cancelled) return;
        setData({ detail, rows, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setData({ detail: null, rows: [], loading: false, error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, bucketSecs]);

  return data;
}
