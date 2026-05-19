import { describe, it, expect, vi } from 'vitest';
import {
  pushSessionsToCloud,
  type CloudPusher,
  type LocalReader,
  type Reading,
  type SessionHeader,
} from '../../src/sync/supabase.ts';

function batchesOf(...batches: Reading[][]) {
  return async function* () {
    for (const b of batches) yield b;
  };
}

describe('pushSessionsToCloud', () => {
  it('skips when there are no unsynced sessions', async () => {
    const reader: LocalReader = {
      unsyncedHeaders: vi.fn(async () => []),
      readingsBatches: vi.fn(() => batchesOf()()),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSignals: vi.fn(async () => new Map()),
      pushSession: vi.fn(async (id: string) => id),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 0, failed: 0, errors: [] });
    expect(pusher.pushSession).not.toHaveBeenCalled();
  });

  it('pushes each unsynced session, streams readings, and marks it synced', async () => {
    const headers: SessionHeader[] = [
      { id: 's1', row: { date: 'x' }, signals: [] },
      { id: 's2', row: {}, signals: [] },
    ];
    const batchesById: Record<string, Reading[][]> = {
      s1: [
        [{ ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 9.9 }],
        [{ ts: '2026-04-22T12:00:01Z', signal_id: 1, value: 10.1 }],
      ],
      s2: [],
    };
    const reader: LocalReader = {
      unsyncedHeaders: vi.fn(async () => headers),
      readingsBatches: vi.fn((id: string) => batchesOf(...(batchesById[id] ?? []))()),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSignals: vi.fn(async () => new Map()),
      pushSession: vi.fn(async (id: string) => id),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 2, failed: 0, errors: [] });
    expect(pusher.pushSession).toHaveBeenCalledTimes(2);
    // s1 had 2 batches, s2 had 0.
    expect(pusher.pushReadings).toHaveBeenCalledTimes(2);
    expect(reader.markSynced).toHaveBeenCalledWith('s1');
    expect(reader.markSynced).toHaveBeenCalledWith('s2');
  });

  it('translates local signal_ids through the id map returned by pushSignals', async () => {
    const reader: LocalReader = {
      unsyncedHeaders: vi.fn(async () => [
        {
          id: 's1',
          row: {},
          signals: [{ local_id: 7, source: 'a', signal_name: 'b', unit: null, description: null }],
        },
      ]),
      readingsBatches: vi.fn(() =>
        batchesOf([{ ts: 't', signal_id: 7, value: 1 }])(),
      ),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSignals: vi.fn(async () => new Map([[7, 700]])),
      pushSession: vi.fn(async (id: string) => id),
      pushReadings: vi.fn(async () => {}),
    };

    await pushSessionsToCloud(reader, pusher);
    expect(pusher.pushReadings).toHaveBeenCalledWith('s1', [
      { ts: 't', signal_id: 700, value: 1 },
    ]);
  });

  it('routes readings to the cloud id returned by pushSession (hash dedup)', async () => {
    // Machine B is syncing a re-import of a file that machine A already
    // pushed. pushSession sees the matching source_file_hash and returns the
    // existing cloud session id; readings go under that id.
    const reader: LocalReader = {
      unsyncedHeaders: vi.fn(async () => [
        { id: 'local-B', row: { source_file_hash: 'abc' }, signals: [] },
      ]),
      readingsBatches: vi.fn(() =>
        batchesOf([{ ts: 't', signal_id: 1, value: 1 }])(),
      ),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSignals: vi.fn(async () => new Map()),
      pushSession: vi.fn(async () => 'cloud-A'), // dedup hit
      pushReadings: vi.fn(async () => {}),
    };

    await pushSessionsToCloud(reader, pusher);
    expect(pusher.pushReadings).toHaveBeenCalledWith('cloud-A', [
      { ts: 't', signal_id: 1, value: 1 },
    ]);
  });

  it('continues on per-session push failures and reports counts', async () => {
    const reader: LocalReader = {
      unsyncedHeaders: vi.fn(async () => [
        { id: 'good', row: {}, signals: [] },
        { id: 'bad', row: {}, signals: [] },
      ]),
      readingsBatches: vi.fn(() => batchesOf()()),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSignals: vi.fn(async () => new Map()),
      pushSession: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('rate limited');
        return id;
      }),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toMatchObject({ pushed: 1, failed: 1 });
    expect(reader.markSynced).toHaveBeenCalledTimes(1);
    expect(reader.markSynced).toHaveBeenCalledWith('good');
  });
});
