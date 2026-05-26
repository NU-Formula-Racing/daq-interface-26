import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearStalePidLock } from '../../src/db/postgres-manager.ts';

describe('clearStalePidLock', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pg-cleanup-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is a no-op when no postmaster.pid exists', async () => {
    await clearStalePidLock(dir);
    expect(existsSync(join(dir, 'postmaster.pid'))).toBe(false);
  });

  it('deletes postmaster.pid pointing at a dead PID', async () => {
    const lockPath = join(dir, 'postmaster.pid');
    writeFileSync(lockPath, '999999\n/data/dir\nlots of other lines\n', 'utf-8');
    await clearStalePidLock(dir);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('deletes postmaster.pid when the PID is alive but not a postgres owning this dir', async () => {
    // Current node process is alive, but `ps` will show it as `node ...`, not
    // `postgres -D ...`. The helper should treat the lock as junk and delete.
    const lockPath = join(dir, 'postmaster.pid');
    writeFileSync(lockPath, `${process.pid}\n`, 'utf-8');
    await clearStalePidLock(dir);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('preserves postmaster.pid when the file is malformed', async () => {
    const lockPath = join(dir, 'postmaster.pid');
    writeFileSync(lockPath, 'not a pid\n', 'utf-8');
    await clearStalePidLock(dir);
    expect(existsSync(lockPath)).toBe(true);
  });
});
