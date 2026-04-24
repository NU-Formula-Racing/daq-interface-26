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

describe('buildApp', () => {
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

  it('responds to GET /api/health with ok', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('exposes GET /api/config returning the current app_config data', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({});
    } finally {
      await app.close();
    }
  });

  it('POST /api/config merges a partial patch', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: { watchDir: '/tmp/sd' },
      });
      expect(res.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/config' });
      expect(after.json()).toMatchObject({ watchDir: '/tmp/sd' });
    } finally {
      await app.close();
    }
  });

  it('GET / returns either the built UI or the "not built" fallback (never 500)', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect([200, 404]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });

  it('Non-API paths fall through to index.html (client-side router)', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/sessions/abc' });
      // If dist exists: 200 + html. If not: 200 + notice html.
      expect([200]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });

  it('Unknown /api/ paths still 404 rather than fall through to index.html', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET /api/config never returns the authToken key', async () => {
    await pool.query(
      `UPDATE app_config SET data = data || '{"authToken":"supersecret","watchDir":"/tmp"}'::jsonb WHERE id = 1`
    );
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/config' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ watchDir: '/tmp' });
      expect(body).not.toHaveProperty('authToken');
    } finally {
      await app.close();
    }
  });
});
