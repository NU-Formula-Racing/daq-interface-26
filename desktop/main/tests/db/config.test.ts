import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { getAppConfig, setAppConfig } from '../../src/db/config.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('app_config helpers', () => {
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

  it('returns {} for a freshly seeded config row', async () => {
    const cfg = await getAppConfig(pool);
    expect(cfg).toEqual({});
  });

  it('persists a patch across reads', async () => {
    await setAppConfig(pool, { serialPort: '/dev/cu.usb', broadcastEnabled: false });
    expect(await getAppConfig(pool)).toEqual({
      serialPort: '/dev/cu.usb',
      broadcastEnabled: false,
    });
  });

  it('merges patches instead of overwriting', async () => {
    await setAppConfig(pool, { serialPort: '/dev/cu.usb' });
    await setAppConfig(pool, { broadcastEnabled: true });
    expect(await getAppConfig(pool)).toEqual({
      serialPort: '/dev/cu.usb',
      broadcastEnabled: true,
    });
  });
});
