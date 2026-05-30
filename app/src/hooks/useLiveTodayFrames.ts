import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeLive } from '../api/ws.ts';
import { apiGet } from '../api/client.ts';
import type { ParserEvent, SignalWindowRow } from '../api/types.ts';
import type { FramesStore as IFramesStore, FrameRow } from '@nfr/widgets';

/** Private FramesStore for live_today data. Shape matches useLiveFrames /
 *  useReplayFrames so the dock widgets see a familiar interface, but each
 *  hook owns its own store so cross-mode bleed-through can't happen.
 *
 *  Memory bound: each signal's buffer is capped so a long live session
 *  doesn't accumulate millions of FrameRow objects in the renderer.
 *  When a buffer crosses MAX_ROWS_PER_SIGNAL, we slice off the oldest
 *  TRIM_DOWN_TO rows in one pass — amortized O(1) per push instead of
 *  per-push trimming. Trimmed rows still exist in live_today on disk;
 *  if the user scrolls back past the in-memory window, ensureWindow()
 *  pages them back in via /api/live/window.
 *
 *  Order: WS frames arrive monotonically in ts order, so we append
 *  without re-sorting. A dev-mode invariant guard logs if a row ever
 *  arrives older than the previous one — that would indicate a real
 *  protocol bug, not data the dock should silently absorb. */
const MAX_ROWS_PER_SIGNAL = 50_000;
const TRIM_DOWN_TO = 37_500;

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
    // Track which buffers got an out-of-order row this batch and need a
    // tail sort. The common (WS-edge) case touches none of these and
    // stays O(rows). ensureWindow inserting backfill races with the live
    // edge land here; we sort once per affected buffer rather than every
    // push like the old code did.
    const needSort = new Set<number>();
    for (const r of rows) {
      let buf = this.bySignal.get(r.signal_id);
      if (!buf) { buf = []; this.bySignal.set(r.signal_id, buf); }
      const tail = buf[buf.length - 1];
      if (tail && r.ts < tail.ts) needSort.add(r.signal_id);
      buf.push(r);
      touched.add(r.signal_id);
      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < r.ts) this.latestBySignal.set(r.signal_id, r);
      if (this._firstTs === null || r.ts < this._firstTs) this._firstTs = r.ts;
      if (this._latestTs === null || r.ts > this._latestTs) this._latestTs = r.ts;
    }
    for (const id of needSort) {
      this.bySignal.get(id)!.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    // Enforce the per-signal cap. Splice off the front in one pass so
    // each push is amortized O(1) — naively trimming every row would
    // turn long live sessions into a quadratic mess.
    let firstTsMaybeStale = false;
    for (const id of touched) {
      const buf = this.bySignal.get(id)!;
      if (buf.length > MAX_ROWS_PER_SIGNAL) {
        buf.splice(0, buf.length - TRIM_DOWN_TO);
        firstTsMaybeStale = true;
      }
    }
    if (firstTsMaybeStale) this.recomputeFirstTs();
    this.version++;
    for (const l of this.listeners) l();
  }

  private recomputeFirstTs(): void {
    let earliest: string | null = null;
    for (const buf of this.bySignal.values()) {
      if (buf.length === 0) continue;
      const head = buf[0].ts;
      if (earliest === null || head < earliest) earliest = head;
    }
    this._firstTs = earliest;
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
    setStatus('loading');
    // Live mode: ask for raw rows, no bucket averaging. The avg-per-bucket
    // path produced fractional values and wrap-spikes for integer/cyclic
    // signals like RTC_Second. We accept the row-count cap on long windows
    // (~100k rows, set server-side) — sufficient for the rolling-day buffer
    // at typical CAN rates.
    const url =
      `/api/live/window?ids=${need.join(',')}` +
      `&start=${encodeURIComponent(start)}` +
      `&end=${encodeURIComponent(end)}` +
      `&raw=1`;
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
