import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { seedSessionWithReadings, type SeededSession } from '../helpers/seed.ts';
import { buildApp } from '../../src/server/app.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('sessions API', () => {
  let db: ScratchDb;
  let pool: pg.Pool;
  let seed: SeededSession;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    pool = new pg.Pool({ connectionString: db.url, max: 3 });
    seed = await seedSessionWithReadings(pool);
  });

  afterAll(async () => {
    await pool.end();
    await db.drop();
  });

  it('GET /api/sessions returns the seeded session', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        id: seed.sessionId,
        source: 'live',
        track: 'Track 1',
        driver: 'Alice',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /api/sessions/:id returns detail with available signals', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${seed.sessionId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(seed.sessionId);
      expect(body.signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ signal_name: 'bus_v', source: 'PDM' }),
          expect.objectContaining({ signal_name: 'soc', source: 'BMS_SOE' }),
        ])
      );
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/sessions/:id updates metadata', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${seed.sessionId}`,
        payload: { notes: 'wet track', car: 'NFR26' },
      });
      expect(res.statusCode).toBe(200);

      const after = await app.inject({
        method: 'GET',
        url: `/api/sessions/${seed.sessionId}`,
      });
      expect(after.json()).toMatchObject({ notes: 'wet track', car: 'NFR26' });
    } finally {
      await app.close();
    }
  });

  it('GET /api/sessions/:id/overview returns bucketed averages', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${seed.sessionId}/overview?bucket=30`,
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json();
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r).toMatchObject({
          bucket: expect.any(String),
          signal_id: expect.any(Number),
          avg_value: expect.any(Number),
        });
      }
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/sessions/:id cascades reading deletes', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${seed.sessionId}`,
      });
      expect(res.statusCode).toBe(204);

      const { rows } = await pool.query(
        'SELECT count(*)::int AS c FROM sd_readings WHERE session_id = $1',
        [seed.sessionId]
      );
      expect(rows[0].c).toBe(0);

      const list = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(list.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
