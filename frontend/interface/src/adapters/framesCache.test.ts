import { describe, it, expect } from 'vitest';
import { FramesCache, frameCacheKey } from './framesCache';

describe('frameCacheKey', () => {
  it('is stable across signal-id ordering', () => {
    expect(frameCacheKey('s1', [3, 1, 2], 't1', 't2', 5))
      .toBe(frameCacheKey('s1', [1, 2, 3], 't1', 't2', 5));
  });
  it('differs when any field differs', () => {
    const base = frameCacheKey('s1', [1], 't1', 't2', 5);
    expect(base).not.toBe(frameCacheKey('s2', [1], 't1', 't2', 5));
    expect(base).not.toBe(frameCacheKey('s1', [2], 't1', 't2', 5));
    expect(base).not.toBe(frameCacheKey('s1', [1], 't1', 't3', 5));
    expect(base).not.toBe(frameCacheKey('s1', [1], 't1', 't2', 10));
  });
});

describe('FramesCache', () => {
  it('marks signal IDs hit on a key the cache already has', () => {
    const c = new FramesCache(4);
    c.recordFetch('s1', [1, 2], 't1', 't2', 5);
    expect(c.alreadyFetched('s1', [1, 2], 't1', 't2', 5)).toBe(true);
    expect(c.alreadyFetched('s1', [1], 't1', 't2', 5)).toBe(true);
    expect(c.alreadyFetched('s1', [3], 't1', 't2', 5)).toBe(false);
  });

  it('missing returns just the IDs not yet fetched for the window', () => {
    const c = new FramesCache(4);
    c.recordFetch('s1', [1, 2], 't1', 't2', 5);
    expect(c.missing('s1', [1, 2, 3, 4], 't1', 't2', 5)).toEqual([3, 4]);
  });

  it('resetSession drops all entries for a session', () => {
    const c = new FramesCache(4);
    c.recordFetch('s1', [1], 't1', 't2', 5);
    c.recordFetch('s2', [1], 't1', 't2', 5);
    c.resetSession('s1');
    expect(c.alreadyFetched('s1', [1], 't1', 't2', 5)).toBe(false);
    expect(c.alreadyFetched('s2', [1], 't1', 't2', 5)).toBe(true);
  });

  it('LRU evicts oldest entry past cap', () => {
    const c = new FramesCache(2);
    c.recordFetch('s1', [1], 'a', 'b', 5);
    c.recordFetch('s1', [2], 'a', 'b', 5);
    c.recordFetch('s1', [3], 'a', 'b', 5);
    expect(c.alreadyFetched('s1', [1], 'a', 'b', 5)).toBe(false);
    expect(c.alreadyFetched('s1', [2], 'a', 'b', 5)).toBe(true);
    expect(c.alreadyFetched('s1', [3], 'a', 'b', 5)).toBe(true);
  });
});
