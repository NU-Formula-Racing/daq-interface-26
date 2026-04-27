import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pg from 'pg';
import {
  PostgresManager,
  postgresBinDir,
} from '../../src/db/postgres-manager.ts';

describe('PostgresManager', () => {
  let dataDir: string;
  let mgr: PostgresManager;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pgmgr-'));
    mgr = new PostgresManager({
      binDir: postgresBinDir(),
      dataDir,
      port: 54399, // pick something unlikely to clash
      superuser: 'nfr',
    });
  });

  afterAll(async () => {
    if (mgr.running) await mgr.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('initializes a fresh data directory if missing', async () => {
    await mgr.ensureInitialized();
    expect(existsSync(join(dataDir, 'PG_VERSION'))).toBe(true);
  }, 60_000);

  it('starts and accepts connections', async () => {
    await mgr.start();
    expect(mgr.running).toBe(true);
    const client = new pg.Client({
      connectionString: `postgres://nfr@127.0.0.1:54399/postgres`,
    });
    await client.connect();
    const r = await client.query('SELECT 1 as ok');
    expect(r.rows[0].ok).toBe(1);
    await client.end();
  }, 60_000);

  it('stops cleanly', async () => {
    await mgr.stop();
    expect(mgr.running).toBe(false);
  }, 30_000);

  it('detects a non-NFR data directory', async () => {
    const other = mkdtempSync(join(tmpdir(), 'pgmgr-other-'));
    const probe = new PostgresManager({
      binDir: postgresBinDir(),
      dataDir: other,
      port: 54398,
      superuser: 'nfr',
    });
    expect(await probe.isInitialized()).toBe(false);
    rmSync(other, { recursive: true, force: true });
  });
});
