# Postgres Stale-State Cleanup on Launch — Design

**Date:** 2026-05-25
**Status:** Draft for review

## 1. Problem

When the desktop is hard-killed (force-quit, OS crash, Activity Monitor → Force Quit, `kill -9`, etc.) the embedded Postgres subprocess doesn't always get to release its SysV shared-memory block or clean up its `postmaster.pid` lock file. The next launch then fails with one of:

```
FATAL: lock file "postmaster.pid" already exists
HINT: Is another postmaster (PID 55728) running ...?
```

```
FATAL: pre-existing shared memory block (key 38322896, ID 1114112) is still in use
HINT: Terminate any old server processes ...
```

Right now the user has to manually `kill -9` the old process (or discover it's already dead and delete the .pid file), then `ipcrm -m <id>` to release the orphaned shmem. That's beyond what a non-technical teammate is going to figure out. Real-world failure mode reported today on macOS Tahoe.

## 2. Goal

Before Postgres starts on every launch, detect and clear the two stale-state cases above so the app boots cleanly without manual intervention.

## 3. Non-goals

- Cleaning up other lingering processes (zombie parser subprocesses, etc.). Out of scope.
- Cleaning `/tmp/up-*` temp dirs from interrupted upload runs. Out of scope.
- Migration partial-state rollback. Already handled by the migration runner's transaction wrapping.
- Detecting actual data corruption from an unclean shutdown. Postgres handles WAL replay automatically; we trust it.

## 4. Architecture

A new helper `cleanStalePgState(dataDir, port)` in `desktop/main/src/db/postgres-manager.ts`. Called from `PostgresManager.start()` immediately before `spawn(postgres, ...)`. Pure function-shaped — takes the data directory path and the port we plan to listen on; returns `void`; logs what it did to stderr for observability.

Plus a small retry around the existing 20-second readiness probe: if Postgres dies during startup with a `pre-existing shared memory block` error, parse the shmid from its stderr, run `ipcrm -m <id>`, and retry the spawn exactly once. Don't loop indefinitely — if it fails a second time, surface the error.

### 4.1 Stale `postmaster.pid` handling

```
path = <dataDir>/postmaster.pid
if not exists: nothing to do
read first line → parse integer pid
try kill(pid, 0):
  - ESRCH or EPERM-with-Postgres-pattern → file is stale, delete it
  - ok → process exists. Check it's actually a postgres process owning OUR data dir:
      run `ps -p <pid> -o command=`. If the command line includes `postgres` and
      `-D <dataDir>`: leave alone, we're done (someone already launched us).
      Otherwise: it's a different process that happens to have that PID. Delete
      the .pid file — Postgres would refuse to start anyway.
```

### 4.2 Orphan SysV shared memory handling — primary path: retry-on-failure

Don't try to enumerate `ipcs` proactively; on macOS the output format isn't perfectly portable and we'd risk false positives. Instead:

```
spawn postgres
read stderr
if stderr matches /pre-existing shared memory block \(key \d+, ID (\d+)\)/:
  child.kill() if still running
  exec `ipcrm -m <id>`  (best effort; ignore non-zero)
  retry spawn exactly once
```

The error message includes the ID; we just parse and pass it to `ipcrm`. Done.

### 4.3 Where the helper lives

```ts
// desktop/main/src/db/postgres-manager.ts (extend existing file)

/** Delete a stale postmaster.pid lock if the PID it claims isn't a running
 *  postgres process owning our data dir. No-op if everything's clean. */
async function clearStalePidLock(dataDir: string): Promise<void> { ... }

/** Best-effort: run `ipcrm -m <id>` to release an orphaned SysV shmem
 *  block. Non-zero exit is ignored (block may have already been released,
 *  or we're on a platform that uses POSIX shmem). */
async function ipcrmShared(id: string): Promise<void> { ... }
```

`start()` is extended to:
1. Call `await clearStalePidLock(this.opts.dataDir)` before spawn.
2. Wrap the spawn + readiness wait in a one-retry loop. If stderr contains the shmem-orphan signature, capture the ID, kill the child, call `ipcrmShared`, and try again.

## 5. Error handling

- `clearStalePidLock` swallows all errors (logs to stderr) — best-effort cleanup must not block startup.
- `ipcrmShared` swallows non-zero exit — the block may have been released by the OS in the meantime, or we're on Windows / a different IPC model.
- If after one retry Postgres still won't start, the existing error path bubbles up to the setup screen with the original Postgres stderr in `setupState.lastError`. User sees the same error they would have today — but only in the very rare case where the cleanup didn't help.

## 6. Testing

- **Unit:** `clearStalePidLock` with a fixture data-dir containing:
  - No `postmaster.pid` → no-op.
  - `postmaster.pid` with PID `999999` (definitely not running) → file deleted.
  - `postmaster.pid` with current process PID → file preserved (heuristic: PID alive + command line doesn't match `postgres -D`).
- **Integration:** spin up a `postgres` child, kill -9 it, ensure the next `PostgresManager.start()` succeeds without intervention. Confirms both branches together against a real shmem block.

## 7. Implementation scope

~50 LoC of code + ~30 LoC of tests. Single file modification (`postgres-manager.ts`) plus a new test file. No schema changes, no migrations.

## 8. Out-of-scope follow-ups

- Cleanly stop Postgres in `app.on('will-quit')` so the cleanup-on-launch is unnecessary in normal use. Worth doing later; this spec covers the failure-mode-already-occurred case.
- Cleanup of stale parser subprocesses on launch (PID file in user-data dir?).
- macOS POSIX shared-memory cleanup (Postgres uses SysV by default on macOS; if that changes, this design's `ipcrm` won't help — but that's a Postgres-version-future concern).
