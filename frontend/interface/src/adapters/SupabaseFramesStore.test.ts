import { describe, it, expect, vi } from 'vitest';
import { SupabaseFramesStore } from './SupabaseFramesStore';

describe('SupabaseFramesStore', () => {
  it('partitions ingested rows by signal_id', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:00Z', signal_id: 1, value_avg: 10, value_min: 5,  value_max: 15, sample_n: 100 },
      { ts: '2026-05-01T00:00:01Z', signal_id: 1, value_avg: 12, value_min: 6,  value_max: 18, sample_n: 100 },
      { ts: '2026-05-01T00:00:00Z', signal_id: 2, value_avg: 50, value_min: 49, value_max: 51, sample_n: 100 },
    ]);
    expect(s.series(1)).toHaveLength(2);
    expect(s.series(2)).toHaveLength(1);
    expect(s.series(99)).toEqual([]);
  });

  it('exposes vMin/vMax on each FrameRow', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:00Z', signal_id: 1, value_avg: 10, value_min: 5, value_max: 15, sample_n: 100 },
    ]);
    const [row] = s.series(1);
    expect(row.value).toBe(10);
    expect(row.vMin).toBe(5);
    expect(row.vMax).toBe(15);
  });

  it('tracks first/latest ts across all signals', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:05Z', signal_id: 1, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 },
      { ts: '2026-05-01T00:00:01Z', signal_id: 2, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 },
    ]);
    expect(s.firstTs()).toBe('2026-05-01T00:00:01Z');
    expect(s.latestTs()).toBe('2026-05-01T00:00:05Z');
  });

  it('notifies subscribers on ingest', () => {
    const s = new SupabaseFramesStore();
    const cb = vi.fn();
    const unsub = s.subscribe(cb);
    s.ingest([{ ts: '2026-05-01T00:00:00Z', signal_id: 1, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 }]);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    s.ingest([{ ts: '2026-05-01T00:00:01Z', signal_id: 1, value_avg: 2, value_min: 2, value_max: 2, sample_n: 1 }]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('series() returns rows in ts-ascending order', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:02Z', signal_id: 1, value_avg: 2, value_min: 2, value_max: 2, sample_n: 1 },
      { ts: '2026-05-01T00:00:01Z', signal_id: 1, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 },
    ]);
    expect(s.series(1).map((r) => r.ts)).toEqual(['2026-05-01T00:00:01Z', '2026-05-01T00:00:02Z']);
  });
});
