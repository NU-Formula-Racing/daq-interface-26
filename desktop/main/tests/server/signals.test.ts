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

describe('signals API', () => {
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

  it('GET /api/signal-definitions returns all signals', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/signal-definitions' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBeGreaterThanOrEqual(2);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ signal_name: 'bus_v' }),
          expect.objectContaining({ signal_name: 'soc' }),
        ])
      );
    } finally {
      await app.close();
    }
  });

  it('GET /api/signals/:id/window returns raw rows inside the window', async () => {
    const app = await buildApp({ pool });
    try {
      const start = new Date(seed.baseTs.getTime() + 10_000).toISOString();
      const end = new Date(seed.baseTs.getTime() + 20_000).toISOString();
      const res = await app.inject({
        method: 'GET',
        url: `/api/signals/${seed.signalAId}/window?session=${seed.sessionId}&start=${start}&end=${end}`,
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json();
      expect(rows).toHaveLength(11);
      expect(rows[0].value).toBe(10);
      expect(rows[rows.length - 1].value).toBe(20);
    } finally {
      await app.close();
    }
  });
});
