import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerLiveWindowRoutes } from './live-window.ts';

describe('GET /api/live/window', () => {
  it('passes parsed ids/start/end/bucket to the rpc and returns rows', async () => {
    const query = vi.fn(async () => ({ rows: [
      { ts: '2026-05-28T05:00:00Z', signal_id: 1, signal_name: 'X', unit: '',
        value_min: 0, value_max: 1, value_avg: 0.5, sample_n: 3 },
    ] }));
    const app = Fastify();
    registerLiveWindowRoutes(app, { pool: { query } as any });
    const res = await app.inject({
      method: 'GET',
      url: '/api/live/window?ids=1,2&start=2026-05-28T05:00:00Z&end=2026-05-28T06:00:00Z&bucket=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query as any).mock.calls[0];
    expect(sql).toMatch(/get_live_today_window/);
    expect(params).toEqual([[1, 2], '2026-05-28T05:00:00Z', '2026-05-28T06:00:00Z', 1]);
  });

  it('returns 400 when required params are missing', async () => {
    const query = vi.fn();
    const app = Fastify();
    registerLiveWindowRoutes(app, { pool: { query } as any });
    const res = await app.inject({ method: 'GET', url: '/api/live/window' });
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('raw=1 hits live_today directly and returns one row per sample', async () => {
    const query = vi.fn(async () => ({ rows: [
      { ts: '2026-05-28T05:00:00Z', signal_id: 1, signal_name: 'X', unit: '',
        value_min: 23, value_max: 23, value_avg: 23, sample_n: 1 },
    ] }));
    const app = Fastify();
    registerLiveWindowRoutes(app, { pool: { query } as any });
    const res = await app.inject({
      method: 'GET',
      url: '/api/live/window?ids=1&start=2026-05-28T05:00:00Z&end=2026-05-28T06:00:00Z&raw=1',
    });
    expect(res.statusCode).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = (query as any).mock.calls[0];
    expect(sql).toMatch(/FROM live_today/);
    expect(sql).not.toMatch(/get_live_today_window/);
  });
});
