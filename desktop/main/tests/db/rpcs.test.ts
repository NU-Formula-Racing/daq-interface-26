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

  it('get_session_signal_ids returns distinct signal IDs for the session', async () => {
    const { rows } = await db.client.query(
      `SELECT signal_id FROM get_session_signal_ids($1) ORDER BY signal_id`,
      [f.sessionId]
    );
    const ids = rows.map((r: any) => r.signal_id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([f.signalAId, f.signalBId].sort((a, b) => a - b));
  });

  it('get_signals_window accepts DOUBLE PRECISION bucket_secs and returns envelope columns', async () => {
    const start = f.baseTs;
    const end = new Date(f.baseTs.getTime() + 60_000);

    // Coarse bucket: 10s → 6 buckets per signal → 12 rows total.
    const { rows: coarse } = await db.client.query(
      `SELECT * FROM get_signals_window($1, $2::integer[], $3::timestamptz, $4::timestamptz, 10.0::double precision)
       ORDER BY ts, signal_id`,
      [f.sessionId, [f.signalAId, f.signalBId], start, end]
    );
    expect(coarse).toHaveLength(12);
    for (const r of coarse) {
      const vMin = Number(r.value_min);
      const vMax = Number(r.value_max);
      const vAvg = Number(r.value_avg);
      expect(vMin).toBeLessThanOrEqual(vAvg);
      expect(vAvg).toBeLessThanOrEqual(vMax);
      expect(Number(r.sample_n)).toBeGreaterThan(0);
      expect(typeof r.signal_name).toBe('string');
    }

    // Sub-second bucket (0.5s). With 1 sample/second per signal, each bucket
    // holds 0 or 1 samples — most are empty so we expect roughly 60 non-empty
    // rows per signal (i.e. ≤ 120 total), still ≥ the coarse count.
    const { rows: fine } = await db.client.query(
      `SELECT * FROM get_signals_window($1, $2::integer[], $3::timestamptz, $4::timestamptz, 0.5::double precision)
       ORDER BY ts, signal_id`,
      [f.sessionId, [f.signalAId, f.signalBId], start, end]
    );
    expect(fine.length).toBeGreaterThanOrEqual(coarse.length);
    // At fine bucketing, value_min === value_max for buckets holding a single sample.
    for (const r of fine) {
      if (Number(r.sample_n) === 1) {
        expect(Number(r.value_min)).toBe(Number(r.value_max));
        expect(Number(r.value_avg)).toBe(Number(r.value_min));
      }
    }
  });
});
