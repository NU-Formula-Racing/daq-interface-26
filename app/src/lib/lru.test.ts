import { describe, it, expect } from 'vitest';
import { LRU } from './lru';

describe('LRU', () => {
  it('evicts least-recently-used on overflow', () => {
    const c = new LRU<string, number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    c.get('a'); // refresh a
    c.set('d', 4);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
  });

  it('has() does not promote', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.has('a');
    c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
  });

  it('overwriting a key updates recency', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.set('a', 11);
    c.set('c', 3);
    expect(c.get('a')).toBe(11);
    expect(c.get('b')).toBeUndefined();
  });

  it('delete and clear', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1);
    expect(c.delete('a')).toBe(true);
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
  });
});
