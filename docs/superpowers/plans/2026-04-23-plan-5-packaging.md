# Plan 5 — Packaging, Cloud Sync, First-launch UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working dev stack from Plans 1–4 into a shippable desktop application. Specifically: manual cloud sync back to Supabase, a first-launch setup screen when Postgres isn't reachable, a PyInstaller-bundled parser binary, and an electron-builder installer (`.dmg` on macOS) that bundles everything.

**Architecture:** Four independent pieces. (1) A new `POST /api/sync/push` route pushes `synced_at IS NULL` sessions to Supabase over their REST API. (2) `index.ts` becomes fault-tolerant: if `bootstrapDatabase` fails with `ECONNREFUSED`, the server still starts, exposes a `GET /api/setup/status` endpoint, and the UI shows a setup page that polls until the user installs Postgres. (3) PyInstaller produces a single-file parser binary per platform in `parser/dist/`. (4) electron-builder bundles the React UI, the parser binary, the SQL migrations, and a thin Electron main process into a `.dmg`. Tasks 1–3 are fully automatable with tests; Task 4 ends in a manual smoke checklist because installer verification is inherently hands-on.

**Tech Stack:** Fastify 5, `@supabase/supabase-js` (server-side, for cloud sync), `vitest` + `undici` MockAgent for sync tests, PyInstaller, electron 34+, electron-builder. macOS notarization is out of scope — we ship an unsigned `.dmg` in v1.

**Prerequisites:** Plans 1–4 complete. A real Supabase project with the same schema as `desktop/migrations/` (for manual sync testing). Python 3.11+ available to run PyInstaller.

**Out of scope (explicitly deferred to a future plan):**
- Notarized / signed macOS installer.
- Auto-update via electron-updater.
- Windows signing / winget distribution.
- `.exe` and AppImage builds (the config supports them, but we verify only `.dmg` in this plan).
- Retry/backoff semantics for cloud sync beyond "push once, fail the request."

---

### Task 1: Manual cloud sync — `POST /api/sync/push`

**Purpose:** When the laptop is back online, let the user push local sessions to their existing Supabase project with one button press. This is the "B" half of the design spec's relationship-to-cloud decision: local is source-of-truth, cloud is long-term archive.

**Files:**
- Create: `desktop/main/src/sync/supabase.ts`
- Create: `desktop/main/src/server/routes/sync.ts`
- Create: `desktop/main/tests/sync/supabase.test.ts`
- Create: `desktop/main/tests/server/sync.test.ts`
- Modify: `desktop/package.json` (add `@supabase/supabase-js`)
- Modify: `desktop/main/src/server/app.ts` (register the sync route)

Cloud sync reads Supabase credentials from `app_config` (`supabaseUrl`, `supabaseAnonKey`). If they're not set, the endpoint returns a 400 with a clear message.

- [ ] **Step 1: Add the Supabase client**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/desktop
npm install @supabase/supabase-js@^2.81.1
```

- [ ] **Step 2: Write failing unit test `desktop/main/tests/sync/supabase.test.ts`**

We need to test the pure-logic piece of the sync worker without hitting real Supabase. The worker takes two dependencies via function injection: a local-DB reader and a Supabase "push" function.

```ts
import { describe, it, expect, vi } from 'vitest';
import { pushSessionsToCloud, type CloudPusher, type LocalReader } from '../../src/sync/supabase.ts';

describe('pushSessionsToCloud', () => {
  it('skips sessions that are already synced', async () => {
    const reader: LocalReader = {
      unsynced: vi.fn(async () => []),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSession: vi.fn(async () => {}),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 0, failed: 0 });
    expect(pusher.pushSession).not.toHaveBeenCalled();
  });

  it('pushes each unsynced session and marks it synced', async () => {
    const reader: LocalReader = {
      unsynced: vi.fn(async () => [
        { id: 's1', readings: [{ ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 9.9 }] },
        { id: 's2', readings: [] },
      ]),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSession: vi.fn(async () => {}),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 2, failed: 0 });
    expect(pusher.pushSession).toHaveBeenCalledTimes(2);
    expect(pusher.pushReadings).toHaveBeenCalledTimes(2);
    expect(reader.markSynced).toHaveBeenCalledWith('s1');
    expect(reader.markSynced).toHaveBeenCalledWith('s2');
  });

  it('continues on per-session push failures and reports counts', async () => {
    const reader: LocalReader = {
      unsynced: vi.fn(async () => [
        { id: 'good', readings: [] },
        { id: 'bad', readings: [] },
      ]),
      markSynced: vi.fn(async () => {}),
    };
    const pusher: CloudPusher = {
      pushSession: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('rate limited');
      }),
      pushReadings: vi.fn(async () => {}),
    };

    const result = await pushSessionsToCloud(reader, pusher);
    expect(result).toEqual({ pushed: 1, failed: 1 });
    expect(reader.markSynced).toHaveBeenCalledTimes(1);
    expect(reader.markSynced).toHaveBeenCalledWith('good');
  });
});
```

- [ ] **Step 3: Implement `desktop/main/src/sync/supabase.ts`**

```ts
import type pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SessionToPush {
  id: string;
  readings: Array<{ ts: string; signal_id: number; value: number }>;
}

export interface LocalReader {
  unsynced: () => Promise<SessionToPush[]>;
  markSynced: (sessionId: string) => Promise<void>;
}

export interface CloudPusher {
  pushSession: (sessionId: string, row: Record<string, unknown>) => Promise<void>;
  pushReadings: (
    sessionId: string,
    readings: SessionToPush['readings'],
  ) => Promise<void>;
}

export interface PushResult {
  pushed: number;
  failed: number;
}

/**
 * Pure orchestrator: iterates unsynced sessions and pushes each one through
 * the injected `CloudPusher`. Marks each success via `LocalReader.markSynced`.
 * Failures are logged by the caller via the thrown error from `pushSession` —
 * we swallow them here so one bad session doesn't abort the batch.
 */
export async function pushSessionsToCloud(
  reader: LocalReader,
  pusher: CloudPusher,
): Promise<PushResult> {
  const sessions = await reader.unsynced();
  let pushed = 0;
  let failed = 0;
  for (const s of sessions) {
    try {
      await pusher.pushSession(s.id, { /* row built by adapter below */ });
      await pusher.pushReadings(s.id, s.readings);
      await reader.markSynced(s.id);
      pushed++;
    } catch {
      failed++;
    }
  }
  return { pushed, failed };
}

/**
 * Adapter from local Postgres → LocalReader. Reads all unsynced sessions and
 * their sd_readings rows. Mark-synced sets the `synced_at` column.
 */
export function localReaderFromPool(pool: pg.Pool): LocalReader {
  return {
    async unsynced() {
      const { rows: sessions } = await pool.query<{
        id: string;
        date: string;
        started_at: Date;
        ended_at: Date;
        track: string | null;
        driver: string | null;
        car: string | null;
        notes: string | null;
        source: string;
        source_file: string | null;
      }>(`SELECT id, date::text, started_at, ended_at, track, driver, car,
                 notes, source, source_file
          FROM sessions
          WHERE synced_at IS NULL AND ended_at IS NOT NULL
          ORDER BY started_at ASC`);

      const out: SessionToPush[] = [];
      for (const s of sessions) {
        const { rows: readings } = await pool.query<{
          ts: Date;
          signal_id: number;
          value: string;
        }>(`SELECT ts, signal_id, value FROM sd_readings WHERE session_id = $1 ORDER BY ts`,
          [s.id]);
        out.push({
          id: s.id,
          readings: readings.map((r) => ({
            ts: r.ts.toISOString(),
            signal_id: r.signal_id,
            value: Number(r.value),
          })),
        });
      }
      return out;
    },
    async markSynced(id) {
      await pool.query(`UPDATE sessions SET synced_at = now() WHERE id = $1`, [id]);
    },
  };
}

/**
 * Adapter from Supabase credentials → CloudPusher. Writes sessions + readings
 * via Supabase's JS client. We insert into the same table names as the local
 * schema; the hosted project is expected to match.
 */
export function supabaseCloudPusher(
  url: string,
  anonKey: string,
  clientFactory: (u: string, k: string) => SupabaseClient = createClient,
): CloudPusher {
  const client = clientFactory(url, anonKey);
  return {
    async pushSession(sessionId, row) {
      const payload = { id: sessionId, ...row };
      const { error } = await client.from('sessions').upsert(payload);
      if (error) throw new Error(`session upsert failed: ${error.message}`);
    },
    async pushReadings(sessionId, readings) {
      if (readings.length === 0) return;
      const rows = readings.map((r) => ({
        session_id: sessionId,
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value,
      }));
      // Chunk to stay under Supabase's row-count ceiling.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await client.from('sd_readings').insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(`readings insert failed: ${error.message}`);
      }
    },
  };
}
```

Note: the test seeds `CloudPusher.pushSession` with `(id, row) => ...`. In the orchestrator we currently pass `{}` as the row placeholder. For a real push we need the session metadata. Update `pushSessionsToCloud` + `LocalReader.unsynced()` return type to include the row shape. Refactor:

```ts
export interface SessionToPush {
  id: string;
  row: Record<string, unknown>;   // NEW: columns for the sessions upsert
  readings: Array<{ ts: string; signal_id: number; value: number }>;
}

// In orchestrator:
await pusher.pushSession(s.id, s.row);
```

And in `localReaderFromPool.unsynced()`, build `row` from the queried columns:

```ts
out.push({
  id: s.id,
  row: {
    date: s.date,
    started_at: s.started_at.toISOString(),
    ended_at: s.ended_at.toISOString(),
    track: s.track,
    driver: s.driver,
    car: s.car,
    notes: s.notes,
    source: s.source,
    source_file: s.source_file,
  },
  readings: /* existing */,
});
```

Update the test fixtures accordingly (add `row: {}` to each test session). The tests should still pass with one small tweak.

- [ ] **Step 4: Run supabase unit tests — expect 3 passing**

```bash
cd desktop && npx vitest run main/tests/sync/supabase.test.ts
```

- [ ] **Step 5: Write HTTP route test `desktop/main/tests/server/sync.test.ts`**

```ts
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

  it('returns 400 when Supabase credentials are not configured', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'POST', url: '/api/sync/push' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: expect.stringMatching(/supabase/i) });
    } finally {
      await app.close();
    }
  });

  it('pushes via the injected pusher factory and marks sessions synced', async () => {
    await pool.query(
      `UPDATE app_config SET data = data || '{"supabaseUrl":"https://ex.supabase.co","supabaseAnonKey":"k"}'::jsonb WHERE id = 1`,
    );
    const pushedSessions: string[] = [];
    const app = await buildApp({
      pool,
      cloudPusherFactory: () => ({
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
```

- [ ] **Step 6: Implement `desktop/main/src/server/routes/sync.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig } from '../../db/config.ts';
import {
  localReaderFromPool,
  pushSessionsToCloud,
  supabaseCloudPusher,
  type CloudPusher,
} from '../../sync/supabase.ts';

export type CloudPusherFactory = (url: string, anonKey: string) => CloudPusher;

export function registerSyncRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  factory: CloudPusherFactory = supabaseCloudPusher,
) {
  app.post('/api/sync/push', async (_req, reply) => {
    const cfg = await getAppConfig(pool);
    const url = typeof cfg.supabaseUrl === 'string' ? cfg.supabaseUrl : null;
    const key =
      typeof cfg.supabaseAnonKey === 'string' ? cfg.supabaseAnonKey : null;
    if (!url || !key) {
      reply.code(400);
      return { error: 'Supabase credentials not configured in app_config' };
    }

    const pusher = factory(url, key);
    const reader = localReaderFromPool(pool);
    return pushSessionsToCloud(reader, pusher);
  });
}
```

- [ ] **Step 7: Wire into `buildApp`**

Modify `desktop/main/src/server/app.ts`:

1. Add `cloudPusherFactory?: CloudPusherFactory` to `BuildAppOptions`.
2. Import `registerSyncRoutes` and `type CloudPusherFactory` from `./routes/sync.ts`.
3. Call `registerSyncRoutes(app, opts.pool, opts.cloudPusherFactory)` alongside the other route registrations.

- [ ] **Step 8: Run full desktop suite**

```bash
cd desktop && npm test
```

Expect 48 prior + 3 supabase + 2 sync-route = **53 passing**.

- [ ] **Step 9: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/sync/ desktop/main/src/server/routes/sync.ts \
        desktop/main/src/server/app.ts desktop/main/tests/sync/ \
        desktop/main/tests/server/sync.test.ts \
        desktop/package.json desktop/package-lock.json
git commit -m "feat(desktop): POST /api/sync/push for manual Supabase sync"
```

---

### Task 2: First-launch setup UX when Postgres is unreachable

**Purpose:** Right now, if `bootstrapDatabase` throws (because Postgres isn't running on `:5432`), `index.ts` crashes with `fatal:` and the Electron window is blank forever. We want a graceful setup screen instead.

**Files:**
- Create: `desktop/main/src/bootstrap-state.ts`
- Create: `desktop/main/src/server/routes/setup.ts`
- Modify: `desktop/main/src/server/app.ts` (serve setup route even when pool is null)
- Modify: `desktop/main/src/index.ts` (retry-capable boot loop)
- Create: `app/src/pages/Setup.tsx`
- Modify: `app/src/routes.tsx` (add `/setup` route)
- Modify: `app/src/App.tsx` (redirect to `/setup` when server reports `pg: not_reachable`)
- Create: `desktop/main/tests/server/setup.test.ts`

**Approach:** `buildApp` accepts `pool: pg.Pool | null`. When `pool` is null, every `/api/*` route except `/api/setup/*` returns `503 service_unavailable`. A new `GET /api/setup/status` returns `{ pg: "ok" | "not_reachable", lastError?: string }`. `POST /api/setup/retry` attempts `bootstrapDatabase` again. On success, the server rebuilds the app with the now-valid pool.

- [ ] **Step 1: Create `desktop/main/src/bootstrap-state.ts`**

```ts
import type pg from 'pg';

export interface BootstrapState {
  status: 'ok' | 'not_reachable';
  lastError: string | null;
  pool: pg.Pool | null;
}

export function initialBootstrapState(): BootstrapState {
  return { status: 'not_reachable', lastError: null, pool: null };
}
```

- [ ] **Step 2: Write failing test `desktop/main/tests/server/setup.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { buildApp } from '../../src/server/app.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('setup routes', () => {
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

  it('reports pg ok when a pool is provided', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ pg: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('reports pg not_reachable when no pool is provided', async () => {
    const app = await buildApp({ pool: null });
    try {
      const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toMatchObject({ pg: 'not_reachable' });

      // Other /api/* routes should return 503 in degraded mode.
      const sess = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(sess.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 3: Implement `desktop/main/src/server/routes/setup.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export interface SetupState {
  status: 'ok' | 'not_reachable';
  lastError: string | null;
  retry?: () => Promise<{ ok: boolean; error?: string }>;
}

export function registerSetupRoutes(app: FastifyInstance, state: SetupState) {
  app.get('/api/setup/status', async () => ({
    pg: state.status,
    lastError: state.lastError,
  }));

  app.post('/api/setup/retry', async (_req, reply) => {
    if (!state.retry) {
      reply.code(400);
      return { error: 'retry not available' };
    }
    const result = await state.retry();
    return result;
  });
}
```

- [ ] **Step 4: Modify `desktop/main/src/server/app.ts` to accept a nullable pool**

1. Change `BuildAppOptions.pool: pg.Pool` to `pool: pg.Pool | null`.
2. Accept an optional `setupState?: SetupState` argument (typed via `import type { SetupState } from './routes/setup.ts'`). Default a local one to `{ status: pool ? 'ok' : 'not_reachable', lastError: null }`.
3. Register `registerSetupRoutes(app, setupState)` FIRST (before auth, before other routes).
4. Wrap the other route registrations in `if (opts.pool)`. When the pool is null, also install an `onRequest` hook that short-circuits:
   ```ts
   if (!opts.pool) {
     app.addHook('onRequest', async (req, reply) => {
       if (req.url.startsWith('/api/setup/')) return;
       if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
         reply.code(503).send({ error: 'service_unavailable', reason: 'postgres unreachable' });
       }
     });
   }
   ```
5. Static file serving (Task 8 of Plan 4) continues to serve the UI unchanged so the React app can render the setup page.

- [ ] **Step 5: Run new tests — expect 2 passing plus everything else green**

```bash
cd desktop && npm test
```

- [ ] **Step 6: Rewrite `desktop/main/src/index.ts` to handle boot failure gracefully**

```ts
// (top of file unchanged — keep imports, constants)

export async function run(opts: { /* same */ } = {}) {
  const dsn = opts.dsn ?? process.env.NFR_DB_URL ?? 'postgres://postgres@localhost:5432/nfr_local';
  const host = opts.host ?? process.env.NFR_BIND_HOST ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.NFR_BIND_PORT ?? '4444');
  const dbcCsv = opts.dbcCsv ?? join(REPO_ROOT, 'NFR26DBC.csv');

  let pool: pg.Pool | null = null;
  let parser: ParserManager | null = null;
  let watcher: FolderWatcher | null = null;
  let authToken: string | null = null;
  const setupState: import('./server/routes/setup.ts').SetupState = {
    status: 'not_reachable',
    lastError: null,
  };

  const tryBoot = async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const boot = await bootstrapDatabase({ connectionString: dsn, migrationsDir: MIGRATIONS_DIR });
      await boot.client.end();
      pool = createPool({ connectionString: dsn });
      const cfg = await getAppConfig(pool);
      authToken = typeof cfg.authToken === 'string' ? cfg.authToken : null;
      // parser + watcher wiring (copy the existing block from Plan 3/4 version)
      // ... spawn parser, start watcher if configured ...
      setupState.status = 'ok';
      setupState.lastError = null;
      return { ok: true };
    } catch (err) {
      setupState.status = 'not_reachable';
      setupState.lastError = (err as Error).message;
      console.error('boot failed:', err);
      return { ok: false, error: (err as Error).message };
    }
  };

  setupState.retry = tryBoot;
  await tryBoot();   // may succeed or set status=not_reachable

  const app = await buildApp({ pool, parser: parser ?? undefined, authToken, setupState });
  await app.listen({ port, host });

  const shutdown = async () => {
    if (parser) await parser.stop();
    if (watcher) await watcher.stop();
    await app.close();
    if (pool) await pool.end();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { app, pool, parser, watcher, shutdown, host, port };
}
```

The key change: `tryBoot()` runs once on startup, sets `setupState.status` based on result, and is exposed via `setupState.retry` so `POST /api/setup/retry` can re-run it.

**Important simplification:** the "rebuild the Fastify app with a valid pool after retry succeeds" flow is tricky — Fastify routes can't be added after `listen()`. Simplest alternative: after a successful retry, `process.exit(0)` so the user restarts the server. Electron main can wrap the server in its own lifecycle loop and restart automatically.

**Implement it this way:** after `setupState.retry` returns `{ ok: true }`, call `setTimeout(() => process.exit(0), 500)` so the client can see the success response before the process exits. Document that Electron main restarts the process.

- [ ] **Step 7: Create `app/src/pages/Setup.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

interface Status {
  pg: 'ok' | 'not_reachable';
  lastError: string | null;
}

export default function Setup() {
  const [status, setStatus] = useState<Status>({ pg: 'not_reachable', lastError: null });
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const tick = () => apiGet<Status>('/api/setup/status').then(setStatus).catch(() => {});
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (status.pg === 'ok') {
      // PG recovered — server will exit and Electron will restart. Reload the page
      // after a short delay so the user is dropped into the working app.
      setTimeout(() => window.location.reload(), 1500);
    }
  }, [status]);

  const retry = async () => {
    setRetrying(true);
    setMessage('Retrying…');
    try {
      const result = await apiPost<{ ok: boolean; error?: string }>('/api/setup/retry', {});
      if (result.ok) setMessage('Connected. Reloading…');
      else setMessage(result.error ?? 'Still unreachable');
    } catch (err) {
      setMessage(String(err));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-8 font-mono text-[color:var(--color-text)]">
      <div className="max-w-lg w-full space-y-6">
        <h1 className="text-lg tracking-widest">NFR · SETUP REQUIRED</h1>
        <div className="text-xs text-[color:var(--color-text-mute)] space-y-2">
          <p>The NFR local app needs a running PostgreSQL server on <code>localhost:5432</code> with a trust connection for the <code>postgres</code> user.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>macOS:</strong> install <a className="underline" href="https://postgresapp.com/" target="_blank" rel="noreferrer">Postgres.app</a> and launch it. The default install creates a <code>postgres</code> superuser with no password.</li>
            <li><strong>Windows:</strong> download the installer from <a className="underline" href="https://www.postgresql.org/download/windows/" target="_blank" rel="noreferrer">postgresql.org</a>. Keep the default port 5432 and remember the password for <code>postgres</code>.</li>
            <li><strong>Linux:</strong> <code>sudo apt install postgresql</code> (or the equivalent for your distro), then <code>sudo -u postgres psql</code> to verify.</li>
          </ul>
          <p>After Postgres is running, click RETRY below.</p>
        </div>
        {status.lastError && (
          <pre className="text-[10px] text-[color:var(--color-text-faint)] whitespace-pre-wrap">{status.lastError}</pre>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={retry}
            disabled={retrying}
            className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white text-[11px] tracking-widest disabled:opacity-50"
          >
            {retrying ? 'RETRYING…' : 'RETRY'}
          </button>
          <span className="text-[11px] text-[color:var(--color-text-mute)]">{message}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Update `app/src/routes.tsx`** to register `/setup` as a peer route:

```tsx
import Setup from './pages/Setup.tsx';
// inside the routes array, add:
  { path: 'setup', element: <Setup /> },
```

- [ ] **Step 9: Add a small redirect helper in `app/src/App.tsx`**

Import `apiGet` and the router's `useNavigate`. On mount, fetch `/api/setup/status`; if `pg === 'not_reachable'`, navigate to `/setup`.

```tsx
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from './api/client.ts';

// Inside App(), after the existing state/UI setup:
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname === '/setup') return;
    apiGet<{ pg: string }>('/api/setup/status')
      .then((s) => {
        if (s.pg !== 'ok') nav('/setup', { replace: true });
      })
      .catch(() => {
        nav('/setup', { replace: true });
      });
  }, [loc.pathname, nav]);
```

- [ ] **Step 10: Verify**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/app
npx tsc --noEmit && npm run build

cd ../desktop && npm test
```

All tests should still pass.

- [ ] **Step 11: Manual smoke**

Stop your local Postgres (e.g. quit Postgres.app), then:

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/desktop
npx tsx main/src/index.ts &
SERVER_PID=$!
sleep 2
curl -sS http://127.0.0.1:4444/api/setup/status
echo
curl -sS http://127.0.0.1:4444/api/sessions
echo    # expect 503
kill $SERVER_PID
```

Restart Postgres, re-run — `/api/setup/status` should now report `pg: ok`.

Open `http://127.0.0.1:4444/` in a browser when Postgres is off: the UI should redirect to `/setup`.

- [ ] **Step 12: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/bootstrap-state.ts \
        desktop/main/src/server/routes/setup.ts \
        desktop/main/src/server/app.ts desktop/main/src/index.ts \
        desktop/main/tests/server/setup.test.ts \
        app/src/pages/Setup.tsx app/src/routes.tsx app/src/App.tsx
git commit -m "feat(desktop,app): first-launch setup screen when Postgres is unreachable"
```

---

### Task 3: PyInstaller parser bundle

**Purpose:** electron-builder needs to ship a parser binary that runs without a Python install. PyInstaller packs the Python interpreter + all parser dependencies into one executable.

**Files:**
- Create: `parser/build.sh`
- Modify: `parser/.gitignore` (ensure `dist/`, `build/`, `*.spec` are ignored — they may already be)

- [ ] **Step 1: Install PyInstaller in the parser venv**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/parser
.venv/bin/pip install pyinstaller
```

- [ ] **Step 2: Create `parser/build.sh`**

```bash
#!/usr/bin/env bash
# Build a single-file parser binary for the current platform.
# Output: parser/dist/parser-<platform>-<arch>/parser
set -euo pipefail

cd "$(dirname "$0")"

PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
OUT_DIR="dist/parser-${PLATFORM}-${ARCH}"

rm -rf "$OUT_DIR" "build" "parser.spec"
mkdir -p "$OUT_DIR"

.venv/bin/pyinstaller \
  --onefile \
  --name parser \
  --hidden-import psycopg_binary \
  --hidden-import serial \
  --hidden-import serial.tools.list_ports \
  --distpath "$OUT_DIR" \
  __main__.py

echo ""
echo "Built: $OUT_DIR/parser"
"$OUT_DIR/parser" --help | head -20
```

Mark executable: `chmod +x parser/build.sh`.

- [ ] **Step 3: Verify `parser/.gitignore` covers the outputs**

Ensure `parser/.gitignore` (or root `.gitignore`) includes:

```
dist/
build/
*.spec
*.egg-info/
```

- [ ] **Step 4: Run the build**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/parser
./build.sh
```

Expect a ~35–60 MB binary at `parser/dist/parser-darwin-arm64/parser` (on Apple Silicon macOS) or equivalent. The `--help` at the end should print the CLI usage.

- [ ] **Step 5: Smoke the bundled binary against a real DB + a known `.nfr` file**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
psql -U postgres -c "DROP DATABASE IF EXISTS nfr_pyinstaller_smoke"
psql -U postgres -c "CREATE DATABASE nfr_pyinstaller_smoke"
for f in desktop/migrations/*.sql; do
  psql -U postgres -d nfr_pyinstaller_smoke -f "$f"
done

NFR_DB_URL="postgres://postgres@localhost:5432/nfr_pyinstaller_smoke" \
  parser/dist/parser-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/parser \
  batch --dbc NFR26DBC.csv --file parser/testData/3-10-26/LOG_0002.NFR

psql -U postgres -d nfr_pyinstaller_smoke -c \
  "SELECT source, (SELECT count(*) FROM sd_readings WHERE session_id = sessions.id) AS rows FROM sessions"

psql -U postgres -c "DROP DATABASE IF EXISTS nfr_pyinstaller_smoke"
```

Expect the batch to succeed and the SELECT to show ~20,322 readings.

- [ ] **Step 6: Commit the build script (NOT the binary)**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add parser/build.sh parser/.gitignore
git status   # verify dist/, build/, *.spec are NOT staged
git commit -m "build(parser): add PyInstaller single-binary build script"
```

---

### Task 4: electron-builder installer

**Purpose:** Produce a `.dmg` that a user can double-click to install. The installer bundles the React UI, migrations SQL, parser binary, and a thin Electron main process.

**Files:**
- Modify: `desktop/package.json` (add electron + electron-builder deps, `package` script, `build` config)
- Modify: `desktop/main/src/electron-main.ts` (resolve parser + UI paths from `app.getAppPath()` in production)
- Modify: `desktop/main/src/index.ts` (accept parser path via option + fall back to env)
- Create: `desktop/build/entitlements.mac.plist` (empty-ish; required by electron-builder)
- Create: `desktop/build/README.md` (quick packaging instructions)

- [ ] **Step 1: Add electron + electron-builder to `desktop/package.json`**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/desktop
npm install --save-dev electron@^34.0.0 electron-builder@^25.1.8
```

- [ ] **Step 2: Add the `package` script and `build` config to `desktop/package.json`**

In the `"scripts"` block:
```json
  "package": "electron-builder --mac dmg --publish=never"
```

Append a top-level `"build"` block:
```json
  "build": {
    "appId": "com.nfr26.local",
    "productName": "NFR Local",
    "asar": true,
    "files": [
      "main/**/*.{ts,js}",
      "package.json"
    ],
    "extraResources": [
      { "from": "../app/dist", "to": "app" },
      { "from": "migrations", "to": "migrations" },
      { "from": "../parser/dist/parser-${os}-${arch}", "to": "parser" },
      { "from": "../NFR26DBC.csv", "to": "NFR26DBC.csv" }
    ],
    "mac": {
      "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }],
      "category": "public.app-category.developer-tools",
      "icon": "build/icon.icns",
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "hardenedRuntime": false,
      "gatekeeperAssess": false
    },
    "directories": {
      "buildResources": "build",
      "output": "release"
    }
  }
```

- [ ] **Step 3: Create `desktop/build/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

(If you don't have an `.icns` icon, omit the `icon` key from the `mac` config or pass `--config.mac.icon=` to electron-builder; first-time packaging without an icon produces a generic app icon — fine for v1.)

- [ ] **Step 4: Update `desktop/main/src/electron-main.ts`**

Currently it calls `run()` with no options. Add resolution of paths in production:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { run } from './index.ts';

let shutdownFn: (() => Promise<void>) | null = null;

app.whenReady().then(async () => {
  try {
    const resources = process.resourcesPath;   // packaged: <app>.app/Contents/Resources
    const booted = await run({
      dbcCsv: join(resources, 'NFR26DBC.csv'),
      migrationsDir: join(resources, 'migrations'),
      parserBinary: join(resources, 'parser', 'parser'),
    });
    shutdownFn = booted.shutdown;

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await win.loadURL(`http://${booted.host}:${booted.port}`);
  } catch (err) {
    console.error('Electron boot failed:', err);
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (shutdownFn) await shutdownFn();
  app.quit();
});
```

- [ ] **Step 5: Update `desktop/main/src/index.ts` to accept `migrationsDir` and `parserBinary` options**

```ts
export async function run(opts: {
  dsn?: string;
  port?: number;
  host?: string;
  dbcCsv?: string;
  migrationsDir?: string;
  parserBinary?: string;
} = {}) {
  // ...existing resolution...
  const migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;
  const parserBinary =
    opts.parserBinary ??
    process.env.NFR_PARSER_BINARY ??
    PARSER_VENV_PY;   // dev fallback: the venv's python

  // Where we currently pass PARSER_VENV_PY to ParserManager, use parserBinary.
  // Where we currently use MIGRATIONS_DIR, use migrationsDir.
```

If `parserBinary` ends in `.py` we still need `python`; for simplicity, the packaged mode always receives the compiled binary (no `.py`). The args change from `[PARSER_PY, 'live', '--dbc', ...]` to `['live', '--dbc', ...]` when `parserBinary` isn't `.venv/bin/python`.

Simplest split:

```ts
const parserArgs = (parserBinary.endsWith('python') || parserBinary.endsWith('python3'))
  ? [PARSER_PY, /* subcommand + args */]
  : [/* subcommand + args, no script path */];
```

Preserve the existing replay/live/batch arg-construction logic; it just runs against either form.

- [ ] **Step 6: Create `desktop/build/README.md`**

```markdown
# Packaging the NFR Local app

Prerequisites (current machine):
- Plans 1–4 complete.
- `app/dist/` built via `cd app && npm run build`.
- `parser/dist/parser-<platform>-<arch>/parser` built via `cd parser && ./build.sh`.

Build the installer:
    cd desktop
    npm run package

Output: `desktop/release/NFR Local-<version>-<arch>.dmg`.

Drag to `/Applications`, launch. First launch will prompt to install
Postgres if it's not already running.

### What's inside the `.dmg`
- `NFR Local.app/Contents/Resources/app/` — built React UI
- `.../Resources/migrations/` — SQL migrations applied on first launch
- `.../Resources/parser/parser` — the PyInstaller-bundled parser binary
- `.../Resources/NFR26DBC.csv` — default CAN signal definitions
```

- [ ] **Step 7: Build the installer**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations

# Ensure all inputs are current
cd app && npm run build && cd ..
cd parser && ./build.sh && cd ..

# Produce the dmg
cd desktop
npm run package
```

Expected: `desktop/release/NFR Local-0.1.0-arm64.dmg` (name will vary by version/arch). First build downloads the Electron binary (~90 MB, one-time).

- [ ] **Step 8: Manual install smoke checklist**

On a machine (or just locally):

1. Open `desktop/release/NFR Local-*.dmg`.
2. Drag `NFR Local.app` to `/Applications`.
3. Right-click → Open (to bypass Gatekeeper for the unsigned build; first launch only).
4. Window opens to `http://127.0.0.1:4444/`.
5. **If Postgres is not running:** UI shows the `/setup` page. Start Postgres.app, click RETRY. Window reloads to the Live dashboard.
6. **If Postgres is running:** UI loads straight to the Live dashboard with an empty signal picker.
7. Open Settings → paste a replay file path → Save. Quit and relaunch. Live dashboard animates with replay frames.
8. Close window → confirm app quits cleanly (no zombie `parser` / `node` processes in Activity Monitor).

Check each box on this list manually — there's no automated substitute for a real install.

- [ ] **Step 9: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/package.json desktop/package-lock.json \
        desktop/build/ \
        desktop/main/src/electron-main.ts desktop/main/src/index.ts
git commit -m "feat(desktop): electron-builder config + packaged entrypoint"
```

Do NOT commit `desktop/release/*.dmg` — add it to `desktop/.gitignore` if not already covered.

---

## Exit criteria for Plan 5

- `cd desktop && npm test` passes (previous 48 + 3 supabase + 2 sync route + 2 setup = **55 tests**).
- `cd app && npm test` passes (unchanged at 11).
- `cd parser && .venv/bin/pytest` passes (unchanged at 24).
- Running `parser/build.sh` produces a working single-binary that round-trips a `.nfr` file into Postgres.
- Running `cd desktop && npm run package` produces a `.dmg` that, when installed, opens a working live dashboard (with Postgres available) or a setup screen (without).
- `POST /api/sync/push` successfully pushes an unsynced session to a real Supabase project when credentials are configured.
- First-launch UX: when Postgres is not reachable, the UI shows the setup page with install instructions and a working retry button.

After this plan, the app is installable and shippable for internal use. The remaining bells and whistles (notarization, Windows installer, auto-update) are out of scope.
