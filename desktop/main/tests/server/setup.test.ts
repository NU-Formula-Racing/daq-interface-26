import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { buildApp } from '../../src/server/app.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('setup routes', () => {
  let db: ScratchDb;
  let pool: pg.Pool;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    pool = new pg.Pool({ connectionString: db.url, max: 3 });
  });

  afterAll(async () => {
    await pool.end();
    await db.drop();
  });

  it('reports pg ok when a pool is provided', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ pg: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('reports pg not_reachable when no pool is provided', async () => {
    const app = await buildApp({ pool: null });
    try {
      const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ pg: 'not_reachable' });

      const sess = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(sess.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
});
