import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('schema (after running all migrations)', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
  });

  afterAll(async () => {
    await db.drop();
  });

  it('creates all expected tables', async () => {
    const { rows } = await db.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    const tables = rows.map((r) => r.table_name);
    for (const t of [
      'app_config',
      'rt_readings',
      'schema_migrations',
      'sd_readings',
      'sessions',
      'signal_definitions',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('enforces the sessions.source check constraint', async () => {
    await expect(
      db.client.query(
        `INSERT INTO sessions (date, started_at, source)
         VALUES (CURRENT_DATE, now(), 'bogus')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('cascades reading deletes when a session is deleted', async () => {
    await db.client.query(
      `INSERT INTO signal_definitions (source, signal_name, unit)
       VALUES ('TEST', 'sig_a', 'V')`
    );
    const sig = await db.client.query<{ id: number }>(
      `SELECT id FROM signal_definitions WHERE source='TEST' AND signal_name='sig_a'`
    );
    const sid = sig.rows[0].id;

    const sess = await db.client.query<{ id: string }>(
      `INSERT INTO sessions (date, started_at, source)
       VALUES (CURRENT_DATE, now(), 'live')
       RETURNING id`
    );
    const sessionId = sess.rows[0].id;

    await db.client.query(
      `INSERT INTO sd_readings (ts, session_id, signal_id, value)
       VALUES (now(), $1, $2, 1.0)`,
      [sessionId, sid]
    );

    await db.client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    const { rows: remaining } = await db.client.query(
      `SELECT * FROM sd_readings WHERE session_id = $1`,
      [sessionId]
    );
    expect(remaining).toHaveLength(0);
  });

  it('enforces single-row app_config via CHECK (id=1)', async () => {
    await db.client.query(`INSERT INTO app_config (id) VALUES (1) ON CONFLICT DO NOTHING`);
    await expect(
      db.client.query(`INSERT INTO app_config (id) VALUES (2)`)
    ).rejects.toThrow(/check constraint/i);
  });
});
