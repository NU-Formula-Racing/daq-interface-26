import { LRU } from './lru';

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

export class ReplayFramesCache {
  private byKey: LRU<string, true>;
  private bySession = new Map<string, Set<string>>();

  constructor(cap = 64) {
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
