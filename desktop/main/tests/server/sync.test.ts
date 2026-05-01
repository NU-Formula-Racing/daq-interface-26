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

describe('POST /api/sync/push', () => {
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

  it('returns 400 when no cloud backend is configured', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'POST', url: '/api/sync/push' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: expect.stringMatching(/not configured/i),
      });
    } finally {
      await app.close();
    }
  });

  it('pushes via the injected pusher factory and marks sessions synced', async () => {
    await pool.query(
      `UPDATE app_config SET data = data ||
         '{"cloudBackend":"supabase","supabaseUrl":"https://ex.supabase.co","supabaseAnonKey":"k"}'::jsonb
       WHERE id = 1`,
    );
    const pushedSessions: string[] = [];
    const app = await buildApp({
      pool,
      cloudPusherFactory: () => ({
        pushSignals: async () => new Map(),
        pushSession: async (id: string) => {
          pushedSessions.push(id);
        },
        pushReadings: async () => {},
      }),
    });
    try {
      const res = await app.inject({ method: 'POST', url: '/api/sync/push' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pushed).toBe(1);
      expect(body.failed).toBe(0);
      expect(pushedSessions).toEqual([seed.sessionId]);

      const after = await pool.query(
        `SELECT synced_at FROM sessions WHERE id = $1`,
        [seed.sessionId],
      );
      expect(after.rows[0].synced_at).not.toBeNull();
    } finally {
      await app.close();
    }
  });
});
