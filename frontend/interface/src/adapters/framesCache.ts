import { LRU } from '@/lib/lru';

/**
 * Stable key for (session, signal-set, window, bucket). The cache stores one
 * entry per signal id, so individual lookups in `missing()` use a single-id key.
 * Exported for testing.
 */
export function frameCacheKey(
  sessionId: string,
  signalIds: readonly number[],
  start: string,
  end: string,
  bucketSecs: number,
): string {
  const ids = [...signalIds].sort((a, b) => a - b).join(',');
  return `${sessionId}|${start}|${end}|${bucketSecs}|${ids}`;
}

/**
 * Tracks which (session, signal, window, bucket) combinations we've already
 * fetched. Row data lives in `SupabaseFramesStore` — this is purely a "did we
 * ask for it" set, LRU-bounded.
 *
 * `recordFetch(...)` adds one entry per signal id so `missing(...)` can return
 * just the ids the caller still needs to fetch.
 */
export class FramesCache {
  private byKey: LRU<string, true>;
  // Per-session index of keys so we can drop a session's entries in one call.
  private bySession = new Map<string, Set<string>>();

  constructor(cap = 256) {
    this.byKey = new LRU<string, true>(cap);
  }

  recordFetch(
    sessionId: string,
    signalIds: readonly number[],
    start: string,
    end: string,
    bucketSecs: number,
  ): void {
    let set = this.bySession.get(sessionId);
    if (!set) { set = new Set(); this.bySession.set(sessionId, set); }
    for (const id of signalIds) {
      const k = frameCacheKey(sessionId, [id], start, end, bucketSecs);
      this.byKey.set(k, true);
      set.add(k);
    }
  }

  alreadyFetched(
    sessionId: string,
    signalIds: readonly number[],
    start: string,
    end: string,
    bucketSecs: number,
  ): boolean {
    return signalIds.every((id) =>
      this.byKey.has(frameCacheKey(sessionId, [id], start, end, bucketSecs)),
    );
  }

  missing(
    sessionId: string,
    signalIds: readonly number[],
    start: string,
    end: string,
    bucketSecs: number,
  ): number[] {
    return signalIds.filter((id) =>
      !this.byKey.has(frameCacheKey(sessionId, [id], start, end, bucketSecs)),
    );
  }

  resetSession(sessionId: string): void {
    const set = this.bySession.get(sessionId);
    if (!set) return;
    for (const k of set) this.byKey.delete(k);
    this.bySession.delete(sessionId);
  }
}
