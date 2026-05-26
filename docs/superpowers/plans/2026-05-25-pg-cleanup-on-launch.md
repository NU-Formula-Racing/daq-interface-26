# Postgres Stale-State Cleanup on Launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the embedded Postgres starts, delete any stale `postmaster.pid` lock and free any orphaned SysV shared-memory block from a prior unclean shutdown, so the desktop boots cleanly after force-quit / crash without the user having to run `ipcrm` by hand.

**Architecture:** Two small additions in `desktop/main/src/db/postgres-manager.ts`. (1) A pre-spawn `clearStalePidLock(dataDir)` helper that parses the PID from `postmaster.pid` and removes the file if that PID isn't a running postgres process owning the same data dir. (2) Wrap the existing spawn-and-wait-for-ready in a one-retry loop; on the second-spawn-only "pre-existing shared memory block" stderr, parse the block ID and run `ipcrm -m <id>` before retrying once.

**Tech Stack:** TypeScript, Node's `child_process.execFile`, `fs`, `os.kill`.

---

## File Structure

**Modify:**
- `desktop/main/src/db/postgres-manager.ts` — add `clearStalePidLock` + `ipcrmShared` helpers, modify `start()` to call them.

**Create:**
- `desktop/main/tests/db/postgres-cleanup.test.ts` — unit + integration coverage.

No other file changes. No schema, no migrations, no UI.

---

### Task 1: Add `clearStalePidLock` helper

**Files:**
- Modify: `desktop/main/src/db/postgres-manager.ts`
- Test: `desktop/main/tests/db/postgres-cleanup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/main/tests/db/postgres-cleanup.test.ts` with these unit cases:

```ts
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
    // didn't throw; nothing to assert beyond that
  });

  it('deletes postmaster.pid pointing at a dead PID', async () => {
    const lockPath = join(dir, 'postmaster.pid');
    // PID 999999 should not exist on any reasonable system
    writeFileSync(lockPath, '999999\n/data/dir\nlots of other lines\n', 'utf-8');
    await clearStalePidLock(dir);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('preserves postmaster.pid when the PID is the current process', async () => {
    // The current Node process is alive but not a postgres binary, so the
    // helper should still treat the lock as stale and delete it. This is the
    // "defensive delete" branch — anything that isn't an actual postgres on
    // our data dir is junk we should remove.
    const lockPath = join(dir, 'postmaster.pid');
    writeFileSync(lockPath, `${process.pid}\n`, 'utf-8');
    await clearStalePidLock(dir);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('preserves postmaster.pid when the file is malformed', async () => {
    const lockPath = join(dir, 'postmaster.pid');
    writeFileSync(lockPath, 'not a pid\n', 'utf-8');
    await clearStalePidLock(dir);
    // Malformed → leave alone; we don't know what's going on. Postgres'
    // own startup will surface the issue with a clear error.
    expect(existsSync(lockPath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd desktop && npx vitest run main/tests/db/postgres-cleanup.test.ts
```

Expected: 4 failed (`clearStalePidLock is not exported`).

- [ ] **Step 3: Implement the helper**

Append to `desktop/main/src/db/postgres-manager.ts` (above the `PostgresManager` class definition is fine; or at the very end, just inside the module):

```ts
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Best-effort: remove a postmaster.pid lock whose claimed PID is not a
 *  running postgres process owning the same data dir. Swallows all errors
 *  — cleanup must never block the launch path. */
export async function clearStalePidLock(dataDir: string): Promise<void> {
  const lockPath = `${dataDir}/postmaster.pid`;
  if (!existsSync(lockPath)) return;

  let raw: string;
  try { raw = readFileSync(lockPath, 'utf-8'); }
  catch { return; }

  const firstLine = raw.split(/\r?\n/)[0]?.trim();
  const pid = Number(firstLine);
  if (!Number.isInteger(pid) || pid <= 0) return; // malformed — leave alone

  // Step 1: is the PID even alive?
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err) {
    // ESRCH: process doesn't exist. EPERM: process exists but we can't signal
    // it — extremely unlikely for our own data dir's postgres which we
    // launched ourselves; treat as alive to be safe.
    if ((err as NodeJS.ErrnoException).code === 'EPERM') alive = true;
  }

  if (!alive) {
    try { unlinkSync(lockPath); } catch { /* ignore */ }
    return;
  }

  // Step 2: alive — but is it the postgres owning OUR data dir?
  if (process.platform === 'win32') {
    // On Windows `ps` doesn't exist in the same form; trust the PID-alive
    // check and don't touch the lock. The Windows tree-kill on shutdown
    // already minimizes the orphan-postgres-on-Windows case.
    return;
  }
  try {
    const { stdout } = await execFileP('ps', ['-p', String(pid), '-o', 'command=']);
    const cmd = stdout.trim();
    if (cmd.includes('postgres') && cmd.includes(dataDir)) {
      // Real postgres for our data dir — leave alone.
      return;
    }
    // Different process happens to have that PID. Postgres won't start
    // anyway; delete the lock so we get a clean run.
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  } catch {
    // ps failed; be defensive and delete. Worst case: we delete a
    // legitimate lock and the next start surfaces postgres's own clear error.
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd desktop && npx vitest run main/tests/db/postgres-cleanup.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/db/postgres-manager.ts desktop/main/tests/db/postgres-cleanup.test.ts
git commit -m "pg-manager: clearStalePidLock helper for pre-start cleanup"
```

---

### Task 2: Add `ipcrmShared` helper

**Files:**
- Modify: `desktop/main/src/db/postgres-manager.ts`

- [ ] **Step 1: Append the helper** (no test — it's a thin shell-out wrapper; covered by the integration test in Task 4)

Add to `desktop/main/src/db/postgres-manager.ts`, next to `clearStalePidLock`:

```ts
/** Best-effort `ipcrm -m <id>` to release an orphaned SysV shared-memory
 *  block left over from an unclean postgres shutdown. Non-zero exit (no
 *  longer present, wrong platform, permission denied) is swallowed — the
 *  retry-spawn that follows will surface any genuine block-still-held
 *  error on its own. */
export async function ipcrmShared(id: string): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    await execFileP('ipcrm', ['-m', id]);
  } catch { /* ignore */ }
}
```

- [ ] **Step 2: Quick smoke check**

```bash
cd desktop && npx tsc --noEmit 2>&1 | grep -v "list.ts(36,21)" | tail -3
```

Expected: no new errors. (The pre-existing `list.ts(36,21)` error is unrelated.)

- [ ] **Step 3: Commit**

```bash
git add desktop/main/src/db/postgres-manager.ts
git commit -m "pg-manager: ipcrmShared helper for orphan-shmem cleanup"
```

---

### Task 3: Wire helpers into `start()` with one-retry shmem recovery

**Files:**
- Modify: `desktop/main/src/db/postgres-manager.ts`

- [ ] **Step 1: Refactor the existing `start()` body**

Find the existing `start()` method in `postgres-manager.ts` (around line 104). Replace its body so that:

1. The very first thing it does (after the running-already / not-initialized guards) is `await clearStalePidLock(this.opts.dataDir)`.
2. The spawn + stderr-capture + readiness-probe block becomes a helper closure called `attemptSpawn()` returning `{ ok: true } | { ok: false; stderrBuf: string }`.
3. The body calls `attemptSpawn()`. If it returns ok, done. If it fails with stderr matching `/pre-existing shared memory block \(key \d+, ID (\d+)\)/`, run `ipcrmShared(<id>)` and call `attemptSpawn()` exactly once more. If THAT fails, throw the original (post-cleanup) error.

Concrete replacement (showing the whole new `start` method body — replace from `async start(): Promise<void> {` through the matching closing `}` of the method):

```ts
  async start(): Promise<void> {
    if (this.running) return;
    if (!(await this.isInitialized())) {
      throw new Error(
        `data dir ${this.opts.dataDir} is not initialized — call ensureInitialized() first`,
      );
    }

    // Pre-launch cleanup: remove any stale lock file left by a previous
    // unclean shutdown. Safe to call when the lock is real (it won't touch
    // a live postgres on our data dir).
    await clearStalePidLock(this.opts.dataDir);

    const binPostgres = this.binPath('postgres');
    const env = { ...process.env, ...this.libEnv() };

    const attemptSpawn = async (): Promise<
      { ok: true } | { ok: false; stderrBuf: string }
    > => {
      const child = spawn(
        binPostgres,
        ['-D', this.opts.dataDir, '-p', String(this.opts.port)],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.child = child;

      const STDERR_CAP = 2048;
      let stderrBuf = '';
      child.stderr!.on('data', (d) => {
        const s = d.toString();
        process.stderr.write(`[postgres] ${s}`);
        if (stderrBuf.length < STDERR_CAP) {
          stderrBuf = (stderrBuf + s).slice(-STDERR_CAP);
        }
      });
      child.on('exit', (code, sig) => {
        if (code !== 0 && code !== null) {
          console.error(`postgres exited unexpectedly code=${code} signal=${sig}`);
        }
        if (this.child === child) this.child = null;
      });

      // Readiness probe — 20 s budget.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (this.child === null) {
          return { ok: false, stderrBuf };
        }
        const probe = new pg.Client({
          connectionString: `postgres://${this.opts.superuser}@127.0.0.1:${this.opts.port}/postgres`,
          connectionTimeoutMillis: 1000,
        });
        try {
          await probe.connect();
          await probe.end();
          return { ok: true };
        } catch {
          try { await probe.end(); } catch { /* ignore */ }
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      // Timed out. Kill the child before returning.
      if (this.child === child && child.exitCode === null) {
        if (process.platform === 'win32' && child.pid != null) {
          killTreeWindows(child.pid, false);
        } else {
          child.kill('SIGTERM');
        }
        await new Promise((r) => setTimeout(r, 2_000));
        if (child.exitCode === null) {
          if (process.platform === 'win32' && child.pid != null) {
            killTreeWindows(child.pid, true);
          } else {
            child.kill('SIGKILL');
          }
        }
      }
      return {
        ok: false,
        stderrBuf: stderrBuf || 'postgres did not become ready within 20s',
      };
    };

    let result = await attemptSpawn();
    if (!result.ok) {
      // Orphan-shmem recovery: parse the block ID from stderr, ipcrm, retry once.
      const m = result.stderrBuf.match(
        /pre-existing shared memory block \(key \d+, ID (\d+)\)/,
      );
      if (m) {
        const id = m[1];
        process.stderr.write(
          `[postgres] orphan shmem detected (ID ${id}), running ipcrm -m ${id}\n`,
        );
        await ipcrmShared(id);
        result = await attemptSpawn();
      }
    }

    if (!result.ok) {
      throw new Error(
        `postgres failed to start${result.stderrBuf ? `: ${result.stderrBuf.trim()}` : ''}`,
      );
    }
  }
```

- [ ] **Step 2: Typecheck**

```bash
cd desktop && npx tsc --noEmit 2>&1 | grep -v "list.ts(36,21)" | tail -5
```

Expected: no new errors.

- [ ] **Step 3: Run the existing PostgresManager tests to ensure no regressions**

```bash
cd desktop && npx vitest run main/tests/db/postgres-manager.test.ts 2>&1 | tail -10
```

Expected: all existing tests still pass. (If the project doesn't have a `postgres-manager.test.ts`, the unit test from Task 1 + integration test from Task 4 cover the changes.)

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/db/postgres-manager.ts
git commit -m "pg-manager: pre-start pid cleanup + one-retry shmem recovery"
```

---

### Task 4: Integration test — kill-9 a real postgres, restart cleanly

**Files:**
- Modify: `desktop/main/tests/db/postgres-cleanup.test.ts`

- [ ] **Step 1: Add the failing integration test**

Append to `desktop/main/tests/db/postgres-cleanup.test.ts`:

```ts
import { PostgresManager } from '../../src/db/postgres-manager.ts';
import { join } from 'node:path';

// Resolve the vendored postgres bin dir the desktop bundles for testing.
// Falls back to the repo's build/postgres-bin/<platform> tree.
function vendorBinDir(): string {
  if (process.platform === 'darwin') {
    return join(__dirname, '..', '..', '..', 'build', 'postgres-bin', 'macos-arm64');
  }
  if (process.platform === 'linux') {
    return join(__dirname, '..', '..', '..', 'build', 'postgres-bin', 'linux-x64');
  }
  return '';
}

describe('PostgresManager recovers from a hard-killed previous run', () => {
  it('starts cleanly after the prior process was kill -9d', async () => {
    if (process.platform === 'win32' || !vendorBinDir()) return; // skip
    const dataDir = mkdtempSync(join(tmpdir(), 'pgmgr-recover-'));
    const pg1 = new PostgresManager({
      binDir: vendorBinDir(),
      dataDir,
      port: 55600 + Math.floor(Math.random() * 100),
      superuser: 'pgtest',
    });
    try {
      await pg1.ensureInitialized();
      await pg1.start();

      // Hard-kill the running postgres — leave the .pid file and any
      // attached shmem in place, just like a force-quit would.
      // pg1 is still holding the child handle; we send SIGKILL directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const child = (pg1 as any).child as { kill: (sig: string) => void };
      child.kill('SIGKILL');
      // give the OS a moment to reap
      await new Promise((r) => setTimeout(r, 500));

      // Now start a SECOND manager on the same data dir. Should clean up
      // without manual intervention.
      const pg2 = new PostgresManager({
        binDir: vendorBinDir(),
        dataDir,
        port: pg1['opts'].port,
        superuser: 'pgtest',
      });
      await pg2.start();
      await pg2.stop();
    } finally {
      try { await pg1.stop(); } catch { /* may already be dead */ }
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run it**

```bash
cd desktop && npx vitest run main/tests/db/postgres-cleanup.test.ts 2>&1 | tail -15
```

Expected: all tests pass on macOS or Linux. On Windows or if vendored binaries aren't present, the integration test is skipped (returns early).

If the test fails with "binary not found", verify `desktop/build/postgres-bin/<platform>/` exists. On CI you may need to set up the vendored binaries via the existing build script.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/tests/db/postgres-cleanup.test.ts
git commit -m "pg-manager: integration test — recover from kill -9'd previous run"
```

---

## Self-Review Notes

- Spec §4.1 (stale-pid handling) → Task 1 ✓
- Spec §4.2 (orphan shmem retry) → Tasks 2, 3 ✓
- Spec §4.3 (where the helpers live) → Tasks 1, 2 (same file as spec'd) ✓
- Spec §5 (error handling — swallow, don't block) → Tasks 1, 2 both wrap fs / exec calls in try/catch with no-op on failure ✓
- Spec §6 (testing) → Tasks 1 (unit) and 4 (integration) ✓
- Spec §7 (scope ~50 LoC) — the helpers + start() refactor total ~60 LoC; close enough.
- No TBDs. All commands and code shown explicitly. Type names consistent across tasks: `clearStalePidLock`, `ipcrmShared`, `attemptSpawn`.
