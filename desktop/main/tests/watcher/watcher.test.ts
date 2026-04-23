import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { FolderWatcher } from '../../src/watcher/watcher.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('FolderWatcher', () => {
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

  it('invokes the importer once per new .nfr file and dedupes on restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'watch-'));
    const processed: string[] = [];
    try {
      const watcher = new FolderWatcher({
        dir,
        pool,
        importer: async (path) => {
          processed.push(path);
          await pool.query(
            `INSERT INTO sessions (date, started_at, source, source_file) VALUES (CURRENT_DATE, now(), 'sd_import', $1)`,
            [path]
          );
        },
      });

      await watcher.start();

      const p1 = join(dir, 'LOG_0001.NFR');
      writeFileSync(p1, Buffer.alloc(100));
      await new Promise((r) => setTimeout(r, 500));

      const p2 = join(dir, 'LOG_0002.NFR');
      writeFileSync(p2, Buffer.alloc(100));
      await new Promise((r) => setTimeout(r, 500));

      await watcher.stop();

      const watcher2 = new FolderWatcher({
        dir,
        pool,
        importer: async (path) => {
          processed.push('restart:' + path);
        },
      });
      await watcher2.start();
      await new Promise((r) => setTimeout(r, 500));
      await watcher2.stop();

      expect(processed).toEqual([p1, p2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
