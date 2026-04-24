import { describe, it, expect, vi } from 'vitest';
import { pushSessionsToCloud, type CloudPusher, type LocalReader } from '../../src/sync/supabase.ts';

describe('pushSessionsToCloud', () => {
  it('skips sessions that are already synced', async () => {
    const reader: LocalReader = {
      unsynced: vi.fn(async () => []),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSession: vi.fn(async () => {}),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 0, failed: 0 });
    expect(pusher.pushSession).not.toHaveBeenCalled();
  });

  it('pushes each unsynced session and marks it synced', async () => {
    const reader: LocalReader = {
      unsynced: vi.fn(async () => [
        { id: 's1', row: { date: 'x' }, readings: [{ ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 9.9 }] },
        { id: 's2', row: {}, readings: [] },
      ]),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSession: vi.fn(async () => {}),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 2, failed: 0 });
    expect(pusher.pushSession).toHaveBeenCalledTimes(2);
    expect(pusher.pushReadings).toHaveBeenCalledTimes(2);
    expect(reader.markSynced).toHaveBeenCalledWith('s1');
    expect(reader.markSynced).toHaveBeenCalledWith('s2');
  });

  it('continues on per-session push failures and reports counts', async () => {
    const reader: LocalReader = {
      unsynced: vi.fn(async () => [
        { id: 'good', row: {}, readings: [] },
        { id: 'bad', row: {}, readings: [] },
      ]),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSession: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('rate limited');
      }),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 1, failed: 1 });
    expect(reader.markSynced).toHaveBeenCalledTimes(1);
    expect(reader.markSynced).toHaveBeenCalledWith('good');
  });
});
