import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { seedBasicFixture, type Fixture } from '../helpers/fixtures.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('RPC functions', () => {
  let db: ScratchDb;
  let f: Fixture;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    f = await seedBasicFixture(db.client);
  });

  afterAll(async () => {
    await db.drop();
  });

  it('get_session_signals returns both signals for the session', async () => {
    const { rows } = await db.client.query(
      `SELECT * FROM get_session_signals($1) ORDER BY signal_name`,
      [f.sessionId]
    );
    expect(rows.map((r) => r.signal_name)).toEqual(['A', 'B']);
    expect(rows[0].source).toBe('TEST');
    expect(rows[0].unit).toBe('V');
  });

  it('get_signal_window returns rows inside the time window, ordered by ts', async () => {
    const start = new Date(f.baseTs.getTime() + 10_000);
    const end = new Date(f.baseTs.getTime() + 20_000);
    const { rows } = await db.client.query(
      `SELECT * FROM get_signal_window($1, $2, $3, $4)`,
      [f.sessionId, f.signalAId, start, end]
    );
    expect(rows).toHaveLength(11); // 10..20 inclusive
    expect(rows[0].value).toBe(10);
    expect(rows[rows.length - 1].value).toBe(20);
  });

  it('get_signal_downsampled buckets to 10-second averages', async () => {
    const { rows } = await db.client.query(
      `SELECT bucket, avg_value FROM get_signal_downsampled($1, $2, INTERVAL '10 seconds')
       ORDER BY bucket`,
      [f.sessionId, f.signalAId]
    );
    // 60 points, values 0..59 → six buckets of 10, avgs 4.5, 14.5, 24.5, 34.5, 44.5, 54.5
    expect(rows).toHaveLength(6);
    const avgs = rows.map((r) => Number(r.avg_value));
    expect(avgs).toEqual([4.5, 14.5, 24.5, 34.5, 44.5, 54.5]);
  });

  it('get_session_overview buckets all signals at once', async () => {
    const { rows } = await db.client.query(
      `SELECT * FROM get_session_overview($1, 30)
       ORDER BY bucket, signal_id`,
      [f.sessionId]
    );
    // Two buckets x two signals = 4 rows
    expect(rows).toHaveLength(4);
    const byKey = new Map(
      rows.map((r) => [`${r.bucket.toISOString()}_${r.signal_id}`, Number(r.avg_value)])
    );
    // First 30-sec bucket: A avg = 14.5, B avg = 85.5; second: A=44.5, B=55.5
    const b0 = new Date(f.baseTs).toISOString();
    const b1 = new Date(f.baseTs.getTime() + 30_000).toISOString();
    expect(byKey.get(`${b0}_${f.signalAId}`)).toBe(14.5);
    expect(byKey.get(`${b0}_${f.signalBId}`)).toBe(85.5);
    expect(byKey.get(`${b1}_${f.signalAId}`)).toBe(44.5);
    expect(byKey.get(`${b1}_${f.signalBId}`)).toBe(55.5);
  });
});
