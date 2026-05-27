/**
 * live-stream session lifecycle: verify that parser events translate into the
 * expected Supabase calls and the local prior-live-session wipe fires on a
 * new live session_started.
 *
 * No real DB / network — pg.Pool and Supabase client are both mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { startLiveStreamer } from './live-stream.ts';

function makePoolMock(opts: { defs: Array<{ id: number; source: string; signal_name: string }> }) {
  const deleteCalls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    deleteCalls,
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (/SELECT id, source, signal_name FROM signal_definitions/.test(sql)) {
          return { rows: opts.defs };
        }
        if (/DELETE FROM sessions/.test(sql)) {
          deleteCalls.push({ sql, params: params ?? [] });
          return { rowCount: 0 };
        }
        if (/SELECT data FROM app_config/.test(sql)) {
          return {
            rows: [{
              data: {
                cloudLiveEnabled: true,
                supabaseUrl: 'https://x.supabase.co',
                supabaseAnonKey: 'k',
              },
            }],
          };
        }
        return { rows: [] };
      }),
    } as any,
  };
}

function makeSupabaseMock() {
  const inserts: Array<{ table: string; rows: any }> = [];
  const updates: Array<{ table: string; patch: any; where: any }> = [];
  const cloudDefs = [
    { id: 7001, source: 'PDM', signal_name: 'Gen_Amps' },
    { id: 7002, source: 'PDM', signal_name: 'Front_Fan_Amps' },
  ];
  const client = {
    from(table: string) {
      return {
        select: () => Promise.resolve({ data: cloudDefs }),
        insert: (rows: any) => {
          inserts.push({ table, rows });
          return Promise.resolve({ data: null, error: null });
        },
        update: (patch: any) => ({
          eq: (_col: string, val: unknown) => {
            updates.push({ table, patch, where: { [_col]: val } });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    },
  };
  return { client, inserts, updates };
}

describe('startLiveStreamer (live-cloud-sync)', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('opens a live_sessions row, buffers frames, and updates ended_at on session_ended', async () => {
    const pool = makePoolMock({
      defs: [
        { id: 1, source: 'PDM', signal_name: 'Gen_Amps' },
        { id: 2, source: 'PDM', signal_name: 'Front_Fan_Amps' },
      ],
    });
    const sb = makeSupabaseMock();
    const parser = new EventEmitter();

    const streamer = await startLiveStreamer({
      parser,
      pool: pool.pool,
      clientFactory: () => sb.client as any,
    });
    expect(streamer).not.toBeNull();

    const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    parser.emit('event', { type: 'session_started', session_id: sessionId, source: 'live' });
    // Let the awaited refreshIdMap + insert resolve.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    // Prior local live wipe issued.
    expect(pool.deleteCalls).toHaveLength(1);
    expect(pool.deleteCalls[0].sql).toMatch(/DELETE FROM sessions WHERE source = 'live'/);
    expect(pool.deleteCalls[0].params).toEqual([sessionId]);

    // live_sessions INSERT issued.
    const sessInsert = sb.inserts.find((c) => c.table === 'live_sessions');
    expect(sessInsert).toBeTruthy();
    expect(sessInsert!.rows.id).toBe(sessionId);
    expect(sessInsert!.rows.machine).toBeTypeOf('string');

    // Frames after session_started get queued and flushed at the 2 s mark.
    parser.emit('event', {
      type: 'frames',
      rows: [
        { ts: '2026-05-27T10:00:00.100Z', signal_id: 1, value: 12.3 },
        { ts: '2026-05-27T10:00:00.200Z', signal_id: 2, value: 4.5 },
        { ts: '2026-05-27T10:00:00.300Z', signal_id: 999, value: 7 }, // unmapped — dropped
      ],
    });
    await vi.advanceTimersByTimeAsync(2_100);
    await Promise.resolve(); await Promise.resolve();

    const readingsInsert = sb.inserts.find((c) => c.table === 'live_readings');
    expect(readingsInsert).toBeTruthy();
    expect(readingsInsert!.rows).toHaveLength(2);
    expect(readingsInsert!.rows[0]).toEqual({
      ts: '2026-05-27T10:00:00.100Z',
      session_id: sessionId,
      signal_id: 7001,
      value: 12.3,
    });

    parser.emit('event', { type: 'session_ended', session_id: sessionId });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve(); await Promise.resolve();

    const sessUpdate = sb.updates.find((c) => c.table === 'live_sessions');
    expect(sessUpdate).toBeTruthy();
    expect(sessUpdate!.where).toEqual({ id: sessionId });
    expect(sessUpdate!.patch.ended_at).toBeTypeOf('string');

    await streamer!.stop();
  });

  it('returns null when cloudLiveEnabled is false', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{
          data: { cloudLiveEnabled: false, supabaseUrl: 'u', supabaseAnonKey: 'k' },
        }],
      })),
    } as any;
    const result = await startLiveStreamer({ parser: new EventEmitter(), pool });
    expect(result).toBeNull();
  });

  it('ignores frames emitted before any live session_started', async () => {
    const pool = makePoolMock({ defs: [{ id: 1, source: 'PDM', signal_name: 'Gen_Amps' }] });
    const sb = makeSupabaseMock();
    const parser = new EventEmitter();
    const streamer = await startLiveStreamer({
      parser, pool: pool.pool, clientFactory: () => sb.client as any,
    });

    parser.emit('event', {
      type: 'frames',
      rows: [{ ts: '2026-05-27T10:00:00.000Z', signal_id: 1, value: 1.0 }],
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.resolve();

    expect(sb.inserts.find((c) => c.table === 'live_readings')).toBeUndefined();
    await streamer!.stop();
  });
});
