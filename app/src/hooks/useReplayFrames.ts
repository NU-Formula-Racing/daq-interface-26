import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FrameRow, FramesStore } from '@nfr/widgets';
import { apiGet } from '../api/client.ts';
import type { SignalWindowRow } from '../api/types.ts';
import { ReplayFramesCache } from '../lib/replayFramesCache';

class ReplayFramesStore implements FramesStore {
  private bySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  ingest(rows: SignalWindowRow[]): void {
    const touched = new Set<number>();
    for (const r of rows) {
      const frame: FrameRow = {
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value_avg,
        vMin: r.value_min,
        vMax: r.value_max,
        sampleN: r.sample_n,
      };
      let buf = this.bySignal.get(r.signal_id);
      if (!buf) { buf = []; this.bySignal.set(r.signal_id, buf); }
      buf.push(frame);
      touched.add(r.signal_id);
      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < frame.ts) this.latestBySignal.set(r.signal_id, frame);
      if (this._firstTs === null || frame.ts < this._firstTs) this._firstTs = frame.ts;
      if (this._latestTs === null || frame.ts > this._latestTs) this._latestTs = frame.ts;
    }
    for (const id of touched) {
      this.bySignal.get(id)!.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  series(id: number): FrameRow[] { return this.bySignal.get(id) ?? []; }
  latest(id: number): FrameRow | null { return this.latestBySignal.get(id) ?? null; }
  firstTs(): string | null { return this._firstTs; }
  latestTs(): string | null { return this._latestTs; }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  getVersion(): number { return this.version; }
  reset(): void {
    this.bySignal.clear();
    this.latestBySignal.clear();
    this._firstTs = null;
    this._latestTs = null;
    this.version++;
    for (const l of this.listeners) l();
  }
}

const TARGET_BUCKETS = 800;

export interface UseReplayFramesArgs {
  sessionId: string | null;
  signalIds: number[];
  start: string | null;
  end: string | null;
}

export function useReplayFrames(args: UseReplayFramesArgs) {
  const storeRef = useRef<ReplayFramesStore>(new ReplayFramesStore());
  const cacheRef = useRef<ReplayFramesCache>(new ReplayFramesCache(64));
  const store = storeRef.current;
  const cache = cacheRef.current;
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const stateRef = useRef<{
    sessionId: string | null;
    start: string | null;
    end: string | null;
    bucketSecs: number | null;
  }>({ sessionId: null, start: null, end: null, bucketSecs: null });

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
      setStatus('idle');
      return;
    }

    const durationSecs = Math.max(0.001, (Date.parse(args.end) - Date.parse(args.start)) / 1000);
    const bucketSecs = durationSecs / TARGET_BUCKETS;

    const windowChanged =
      stateRef.current.sessionId !== args.sessionId ||
      stateRef.current.start !== args.start ||
      stateRef.current.end !== args.end ||
      stateRef.current.bucketSecs !== bucketSecs;

    if (windowChanged) {
      if (stateRef.current.sessionId) cache.resetSession(stateRef.current.sessionId);
      store.reset();
      stateRef.current = { sessionId: args.sessionId, start: args.start, end: args.end, bucketSecs };
    }

    const toFetch = cache.missing(args.sessionId, args.signalIds, args.start, args.end, bucketSecs);
    if (toFetch.length === 0) {
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    const url =
      `/api/sessions/${args.sessionId}/signals/window` +
      `?ids=${toFetch.join(',')}` +
      `&start=${encodeURIComponent(args.start)}` +
      `&end=${encodeURIComponent(args.end)}` +
      `&bucket=${bucketSecs}`;
    apiGet<SignalWindowRow[]>(url)
      .then((rows) => {
        if (cancelled) return;
        store.ingest(rows);
        cache.recordFetch(args.sessionId!, toFetch, args.start!, args.end!, bucketSecs);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('useReplayFrames fetch failed', err);
        setStatus('error');
      });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, store, cache]);

  return { store, status };
}
