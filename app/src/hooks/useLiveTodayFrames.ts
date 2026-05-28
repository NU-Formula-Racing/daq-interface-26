import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeLive } from '../api/ws.ts';
import { apiGet } from '../api/client.ts';
import type { ParserEvent, SignalWindowRow } from '../api/types.ts';
import type { FramesStore as IFramesStore, FrameRow } from '@nfr/widgets';

/** Private FramesStore for live_today data. Shape matches useLiveFrames /
 *  useReplayFrames so the dock widgets see a familiar interface, but each
 *  hook owns its own store so cross-mode bleed-through can't happen. */
class TodayFramesStore implements IFramesStore {
  private bySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  push(rows: FrameRow[]): void {
    if (rows.length === 0) return;
    const touched = new Set<number>();
    for (const r of rows) {
      let buf = this.bySignal.get(r.signal_id);
      if (!buf) { buf = []; this.bySignal.set(r.signal_id, buf); }
      buf.push(r);
      touched.add(r.signal_id);
      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < r.ts) this.latestBySignal.set(r.signal_id, r);
      if (this._firstTs === null || r.ts < this._firstTs) this._firstTs = r.ts;
      if (this._latestTs === null || r.ts > this._latestTs) this._latestTs = r.ts;
    }
    for (const id of touched) {
      this.bySignal.get(id)!.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  latest(id: number): FrameRow | null { return this.latestBySignal.get(id) ?? null; }
  series(id: number): FrameRow[] { return this.bySignal.get(id) ?? []; }
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

export interface UseLiveTodayFramesResult {
  store: TodayFramesStore;
  ensureWindow: (start: string, end: string, signalIds: number[]) => Promise<void>;
  status: 'idle' | 'loading' | 'ready' | 'error';
}

export function useLiveTodayFrames(): UseLiveTodayFramesResult {
  const storeRef = useRef<TodayFramesStore>(new TodayFramesStore());
  const store = storeRef.current;
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // Per-signal fetched ranges so scroll-back doesn't re-hit the API for
  // ranges already in the store.
  const fetchedRef = useRef<Map<number, Array<[string, string]>>>(new Map());

  // Real-time edge: WS push.
  useEffect(() => {
    const sub = subscribeLive((ev: ParserEvent) => {
      if (ev.type === 'frames') store.push(ev.rows);
    });
    return () => sub.close();
  }, [store]);

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );

  const ensureWindow = async (
    start: string,
    end: string,
    signalIds: number[],
  ): Promise<void> => {
    const need = signalIds.filter((id) => {
      const ranges = fetchedRef.current.get(id) ?? [];
      return !ranges.some(([s, e]) => s <= start && end <= e);
    });
    if (need.length === 0) return;
    const durationSecs = Math.max(0.001, (Date.parse(end) - Date.parse(start)) / 1000);
    const bucketSecs = durationSecs / TARGET_BUCKETS;
    setStatus('loading');
    const url =
      `/api/live/window?ids=${need.join(',')}` +
      `&start=${encodeURIComponent(start)}` +
      `&end=${encodeURIComponent(end)}` +
      `&bucket=${bucketSecs}`;
    try {
      const rows = await apiGet<SignalWindowRow[]>(url);
      store.push(rows.map((r) => ({
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value_avg,
        vMin: r.value_min,
        vMax: r.value_max,
        sampleN: r.sample_n,
      })));
      for (const id of need) {
        const list = fetchedRef.current.get(id) ?? [];
        list.push([start, end]);
        fetchedRef.current.set(id, list);
      }
      setStatus('ready');
    } catch (err) {
      console.error('live window fetch failed', err);
      setStatus('error');
    }
  };

  return { store, ensureWindow, status };
}
