import { describe, it, expect } from 'vitest';
import { LRU } from './lru';

describe('LRU', () => {
  it('set/get keeps recently used entries', () => {
    const c = new LRU<string, number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBe(1);
    c.set('d', 4);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.get('d')).toBe(4);
  });

  it('overwriting an existing key updates recency without evicting others', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.set('a', 11);
    c.set('c', 3);
    expect(c.get('a')).toBe(11);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('has() does not affect recency', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.has('a');
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('clear empties the cache', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });
});
