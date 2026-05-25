import { describe, it, expect } from 'vitest';
import { ReplayFramesCache, frameCacheKey } from './replayFramesCache';

describe('frameCacheKey', () => {
  it('is stable across signal-id order', () => {
    expect(frameCacheKey('s1', [3, 1, 2], 'a', 'b', 0.5))
      .toBe(frameCacheKey('s1', [1, 2, 3], 'a', 'b', 0.5));
  });
});

describe('ReplayFramesCache', () => {
  it('records per signal id and returns the missing subset', () => {
    const c = new ReplayFramesCache(8);
    c.recordFetch('s1', [1, 2], 'a', 'b', 0.5);
    expect(c.missing('s1', [1, 2, 3], 'a', 'b', 0.5)).toEqual([3]);
  });

  it('different window or bucket gives a different key', () => {
    const c = new ReplayFramesCache(8);
    c.recordFetch('s1', [1], 'a', 'b', 0.5);
    expect(c.missing('s1', [1], 'a', 'b', 0.5)).toEqual([]);
    expect(c.missing('s1', [1], 'a', 'b', 0.05)).toEqual([1]);
    expect(c.missing('s1', [1], 'a', 'c', 0.5)).toEqual([1]);
  });

  it('resetSession drops only that session', () => {
    const c = new ReplayFramesCache(8);
    c.recordFetch('s1', [1], 'a', 'b', 0.5);
    c.recordFetch('s2', [1], 'a', 'b', 0.5);
    c.resetSession('s1');
    expect(c.missing('s1', [1], 'a', 'b', 0.5)).toEqual([1]);
    expect(c.missing('s2', [1], 'a', 'b', 0.5)).toEqual([]);
  });

  it('LRU evicts oldest beyond cap', () => {
    const c = new ReplayFramesCache(2);
    c.recordFetch('s1', [1], 'a', 'b', 0.5);
    c.recordFetch('s1', [2], 'a', 'b', 0.5);
    c.recordFetch('s1', [3], 'a', 'b', 0.5);
    expect(c.missing('s1', [1], 'a', 'b', 0.5)).toEqual([1]);
    expect(c.missing('s1', [2], 'a', 'b', 0.5)).toEqual([]);
  });
});
