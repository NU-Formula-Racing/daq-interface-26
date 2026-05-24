import { describe, it, expect } from 'vitest';
import { listCloudSessionsGroupedByDay } from './list.ts';

const fakeSb = {
  from: () => ({
    select: () => ({
      order: () => Promise.resolve({ data: [
        { id: 'a', date: '2026-05-20', total_bytes: 100, content_hash: 'x', manifest_key: 'k1' },
        { id: 'b', date: '2026-05-20', total_bytes: 200, content_hash: 'y', manifest_key: 'k2' },
        { id: 'c', date: '2026-05-21', total_bytes: 50,  content_hash: 'z', manifest_key: 'k3' },
      ], error: null }),
    }),
  }),
} as any;

describe('listCloudSessionsGroupedByDay', () => {
  it('groups by day and sums bytes', async () => {
    const groups = await listCloudSessionsGroupedByDay(fakeSb, new Set(['b']));
    expect(groups).toHaveLength(2);
    expect(groups[0].date).toBe('2026-05-21');
    expect(groups[0].totalBytes).toBe(50);
    expect(groups[1].sessions.find((s) => s.id === 'b')!.alreadyLocal).toBe(true);
  });
});
