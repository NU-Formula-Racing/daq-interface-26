import { describe, it, expect, vi } from 'vitest';
import { FramesStore } from './useLiveFrames.ts';

describe('FramesStore', () => {
  it('tracks latest value per signal and a bounded ring buffer', () => {
    const store = new FramesStore({ bufferSize: 3 });
    store.push([
      { ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 1.0 },
      { ts: '2026-04-22T12:00:01Z', signal_id: 1, value: 2.0 },
      { ts: '2026-04-22T12:00:02Z', signal_id: 1, value: 3.0 },
      { ts: '2026-04-22T12:00:03Z', signal_id: 1, value: 4.0 },
    ]);
    expect(store.latest(1)?.value).toBe(4.0);
    const series = store.series(1);
    expect(series.map((r) => r.value)).toEqual([2.0, 3.0, 4.0]);
  });

  it('notifies subscribers on every push', () => {
    const store = new FramesStore({ bufferSize: 5 });
    const spy = vi.fn();
    const unsub = store.subscribe(spy);
    store.push([{ ts: 't', signal_id: 1, value: 9 }]);
    store.push([{ ts: 't', signal_id: 1, value: 10 }]);
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
    store.push([{ ts: 't', signal_id: 1, value: 11 }]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('latest returns null and series returns [] for unknown ids', () => {
    const store = new FramesStore({ bufferSize: 3 });
    expect(store.latest(999)).toBeNull();
    expect(store.series(999)).toEqual([]);
  });
});
