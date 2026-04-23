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
});
