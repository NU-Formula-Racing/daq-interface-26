import { describe, it, expect } from 'vitest';
import { bucketFor } from './bucketFor';

describe('bucketFor', () => {
  it('targets ~800 buckets across the range', () => {
    expect(bucketFor(3600, 800)).toBe(5);   // 1 hour → 4.5s rounded to 5
    expect(bucketFor(60, 800)).toBe(1);     // 1 min
    expect(bucketFor(300, 800)).toBe(1);    // 5 min → 0.375s → 1
    expect(bucketFor(7200, 800)).toBe(9);   // 2 hours → 9s
  });

  it('never returns less than 1', () => {
    expect(bucketFor(10, 800)).toBe(1);
    expect(bucketFor(0, 800)).toBe(1);
  });
});
