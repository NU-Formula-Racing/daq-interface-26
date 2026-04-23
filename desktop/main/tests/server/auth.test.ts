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

describe('auth token', () => {
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

  it('allows all /api/* requests when token is null (default)', async () => {
    const app = await buildApp({ pool, authToken: null });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects /api/* without token when auth is enabled', async () => {
    const app = await buildApp({ pool, authToken: 'secret123' });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('accepts ?key= query param', async () => {
    const app = await buildApp({ pool, authToken: 'secret123' });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health?key=secret123',
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('accepts Authorization: Bearer header', async () => {
    const app = await buildApp({ pool, authToken: 'secret123' });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { authorization: 'Bearer secret123' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
