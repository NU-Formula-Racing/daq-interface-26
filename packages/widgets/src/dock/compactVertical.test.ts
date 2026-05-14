import { describe, it, expect } from 'vitest';
import { compactVertical } from './compactVertical.ts';

describe('compactVertical', () => {
  it('pulls widgets up into empty rows', () => {
    const input = [
      { id: 'a', col: 1, row: 1, w: 6, h: 2 },
      { id: 'b', col: 1, row: 5, w: 6, h: 2 },  // gap of 2 rows
    ];
    const out = compactVertical(input);
    expect(out.find((w) => w.id === 'b')!.row).toBe(3);
  });

  it('respects horizontal positions when compacting', () => {
    const input = [
      { id: 'a', col: 1, row: 1, w: 4, h: 2 },
      { id: 'b', col: 5, row: 1, w: 4, h: 2 },
      { id: 'c', col: 1, row: 5, w: 4, h: 2 },  // below a only
    ];
    const out = compactVertical(input);
    expect(out.find((w) => w.id === 'c')!.row).toBe(3);
    expect(out.find((w) => w.id === 'b')!.row).toBe(1);
  });

  it('preserves widget metadata', () => {
    const input = [{ id: 'a', col: 1, row: 5, w: 6, h: 2, type: 'graph' as const }];
    const out = compactVertical(input);
    expect(out[0].type).toBe('graph');
    expect(out[0].row).toBe(1);
  });
});
