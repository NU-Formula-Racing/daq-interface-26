import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { bootstrapDatabase } from '../../src/db/bootstrap.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('bootstrapDatabase', () => {
  let db: ScratchDb | null = null;

  afterEach(async () => {
    if (db) await db.drop();
    db = null;
  });

  it('returns a connected client with migrations applied', async () => {
    db = await createScratchDb();
    await db.client.end(); // simulate a fresh start

    const { client, applied } = await bootstrapDatabase({
      connectionString: db.url,
      migrationsDir: MIGRATIONS_DIR,
    });
    try {
      expect(applied).toEqual(['0001_init', '0002_rpcs']);
      const { rows } = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_name='sessions'`
      );
      expect(rows).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('is idempotent across repeated bootstraps', async () => {
    db = await createScratchDb();
    await db.client.end();

    const first = await bootstrapDatabase({
      connectionString: db.url,
      migrationsDir: MIGRATIONS_DIR,
    });
    await first.client.end();

    const second = await bootstrapDatabase({
      connectionString: db.url,
      migrationsDir: MIGRATIONS_DIR,
    });
    try {
      expect(second.applied).toEqual([]);
    } finally {
      await second.client.end();
    }
  });

  it('closes the client if migrations fail', async () => {
    db = await createScratchDb();
    const url = db.url;
    await db.client.end();

    // Point at a nonexistent directory so runMigrations throws on readdir.
    await expect(
      bootstrapDatabase({
        connectionString: url,
        migrationsDir: '/tmp/definitely-not-a-real-dir-bootstrap-test',
      })
    ).rejects.toThrow();

    // If we got here without hanging, the client was closed. Additionally,
    // verify no active connections remain on the scratch DB.
    const { Client } = await import('pg');
    const probe = new Client({ connectionString: url });
    await probe.connect();
    try {
      const { rows } = await probe.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`
      );
      expect(Number(rows[0].c)).toBe(0);
    } finally {
      await probe.end();
    }
  });
});
