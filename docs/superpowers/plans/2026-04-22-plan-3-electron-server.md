# Plan 3 — Electron Main + Fastify Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Plan 1 database and the Plan 2 parser together behind a local Fastify HTTP/WS server, hosted inside an Electron shell. Produce a self-contained desktop app that exposes REST endpoints for session browsing, a WebSocket for live frames, auto-managed parser subprocess, a folder watcher for SD-log imports, and an opt-in broadcast mode for peer devices on the LAN.

**Architecture:** Electron main (Node/TypeScript) runs three long-lived components in-process: (a) a Fastify server listening on `127.0.0.1` by default (toggles to `0.0.0.0` with token auth for broadcast), (b) a ParserManager that spawns `python parser/__main__.py live ...` and streams decoded frames over `/ws/live`, (c) a chokidar folder watcher that queues one-at-a-time SD imports via `python parser/__main__.py batch ...`. The renderer loads the Vite-built React UI served by Fastify and talks to the same server.

**Tech Stack:** Electron 34+, Node 20+, TypeScript, Fastify 5 with `@fastify/websocket` + `@fastify/static`, `pg` (Pool), `chokidar`, `vitest`, `supertest` (for HTTP tests), `ws` (for WS tests). PostgreSQL 14+, Python 3.11+ (from Plan 2).

**Prerequisites:**
- Plans 1 and 2 complete.
- Python parser venv exists at `parser/.venv/` with the parser installable.
- Postgres running on `localhost:5432`.
- `@supabase/supabase-js` is *not* a dependency of this Node side; we talk to our own Fastify server only.

---

### Task 1: Shell scaffold — dependencies, Pool helper, Fastify factory, `app_config` getter/setter

**Files:**
- Modify: `desktop/package.json` (add deps + scripts)
- Create: `desktop/main/src/db/pool.ts`
- Create: `desktop/main/src/db/config.ts`
- Create: `desktop/main/src/server/app.ts`
- Create: `desktop/main/tests/db/config.test.ts`
- Create: `desktop/main/tests/server/app.test.ts`

- [ ] **Step 1: Update `desktop/package.json` with new deps and scripts**

Replace `desktop/package.json` with:

```json
{
  "name": "daq-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev:server": "tsx main/src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fastify/static": "^7.0.4",
    "@fastify/websocket": "^10.0.1",
    "chokidar": "^4.0.1",
    "fastify": "^5.1.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "@types/pg": "^8.11.10",
    "@types/supertest": "^6.0.2",
    "@types/ws": "^8.5.13",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8",
    "ws": "^8.18.0"
  }
}
```

Run: `cd desktop && npm install`. Expect no errors.

- [ ] **Step 2: Create `desktop/main/src/db/pool.ts`**

```ts
import pg from 'pg';

const { Pool } = pg;

export interface PoolOptions {
  connectionString: string;
  max?: number;
}

/**
 * A small Pool wrapper. Prefer this over the one-shot Client returned
 * by `bootstrapDatabase` for route handlers; connections come and go
 * as requests arrive.
 */
export function createPool(opts: PoolOptions): pg.Pool {
  return new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
  });
}
```

- [ ] **Step 3: Write failing test for `app_config`**

Create `desktop/main/tests/db/config.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the test — expect collection error (no config.ts)**

```bash
cd desktop && npx vitest run main/tests/db/config.test.ts
```

- [ ] **Step 5: Implement `desktop/main/src/db/config.ts`**

```ts
import type pg from 'pg';

export type AppConfig = Record<string, unknown>;

export async function getAppConfig(pool: pg.Pool): Promise<AppConfig> {
  const { rows } = await pool.query<{ data: AppConfig }>(
    'SELECT data FROM app_config WHERE id = 1'
  );
  return rows[0]?.data ?? {};
}

export async function setAppConfig(
  pool: pg.Pool,
  patch: AppConfig
): Promise<void> {
  await pool.query(
    'UPDATE app_config SET data = data || $1::jsonb, updated_at = now() WHERE id = 1',
    [JSON.stringify(patch)]
  );
}
```

- [ ] **Step 6: Run the test — expect 3 passing**

- [ ] **Step 7: Write failing test for the Fastify app factory**

Create `desktop/main/tests/server/app.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { buildApp } from '../../src/server/app.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('buildApp', () => {
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

  it('responds to GET /api/health with ok', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('exposes GET /api/config returning the current app_config data', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({});
    } finally {
      await app.close();
    }
  });

  it('POST /api/config merges a partial patch', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/config',
        payload: { watchDir: '/tmp/sd' },
      });
      expect(res.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/config' });
      expect(after.json()).toMatchObject({ watchDir: '/tmp/sd' });
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 8: Implement `desktop/main/src/server/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getAppConfig, setAppConfig } from '../db/config.ts';

export interface BuildAppOptions {
  pool: pg.Pool;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/config', async () => getAppConfig(opts.pool));

  app.post<{ Body: Record<string, unknown> }>(
    '/api/config',
    async (req) => {
      await setAppConfig(opts.pool, req.body ?? {});
      return { ok: true };
    }
  );

  return app;
}
```

- [ ] **Step 9: Run — expect 3 app tests passing (+ 3 config tests from earlier, full suite remains green)**

```bash
cd desktop && npm test
```

- [ ] **Step 10: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/package.json desktop/package-lock.json \
        desktop/main/src/db/pool.ts desktop/main/src/db/config.ts \
        desktop/main/src/server/app.ts \
        desktop/main/tests/db/config.test.ts desktop/main/tests/server/app.test.ts
git commit -m "feat(desktop): add Fastify server scaffold with /api/health and /api/config"
```

---

### Task 2: REST read+write API — sessions, signals, RPC-backed endpoints

**Files:**
- Create: `desktop/main/src/db/sessions.ts`
- Create: `desktop/main/src/db/signals.ts`
- Create: `desktop/main/src/server/routes/sessions.ts`
- Create: `desktop/main/src/server/routes/signals.ts`
- Create: `desktop/main/tests/server/sessions.test.ts`
- Create: `desktop/main/tests/server/signals.test.ts`
- Modify: `desktop/main/src/server/app.ts` (register new route plugins)
- Create: `desktop/main/tests/helpers/seed.ts` (reusable fixture inserting a session + signal + readings)

- [ ] **Step 1: Create a reusable seed helper**

Create `desktop/main/tests/helpers/seed.ts`:

```ts
import type pg from 'pg';

export interface SeededSession {
  sessionId: string;
  signalAId: number;
  signalBId: number;
  baseTs: Date;
}

export async function seedSessionWithReadings(pool: pg.Pool): Promise<SeededSession> {
  const baseTs = new Date('2026-04-22T12:00:00Z');

  const sigA = await pool.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('PDM', 'bus_v', 'V')
     ON CONFLICT (source, signal_name) DO UPDATE SET unit = EXCLUDED.unit
     RETURNING id`
  );
  const sigB = await pool.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('BMS_SOE', 'soc', '%')
     ON CONFLICT (source, signal_name) DO UPDATE SET unit = EXCLUDED.unit
     RETURNING id`
  );

  const sess = await pool.query<{ id: string }>(
    `INSERT INTO sessions (date, started_at, ended_at, source, track, driver)
     VALUES ($1::date, $2, $3, 'live', 'Track 1', 'Alice')
     RETURNING id`,
    [baseTs, baseTs, new Date(baseTs.getTime() + 60_000)]
  );

  const sessionId = sess.rows[0].id;
  const sigAId = sigA.rows[0].id;
  const sigBId = sigB.rows[0].id;

  // 60 samples @ 1 Hz, alternating pattern so RPC avgs are predictable.
  for (let i = 0; i < 60; i++) {
    const ts = new Date(baseTs.getTime() + i * 1000);
    await pool.query(
      `INSERT INTO sd_readings (ts, session_id, signal_id, value)
       VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)`,
      [ts, sessionId, sigAId, i, sigBId, 100 - i]
    );
  }

  return { sessionId, signalAId: sigAId, signalBId: sigBId, baseTs };
}
```

- [ ] **Step 2: Write failing test for sessions routes**

Create `desktop/main/tests/server/sessions.test.ts`:

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

describe('sessions API', () => {
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

  it('GET /api/sessions returns the seeded session', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        id: seed.sessionId,
        source: 'live',
        track: 'Track 1',
        driver: 'Alice',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /api/sessions/:id returns detail with available signals', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${seed.sessionId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(seed.sessionId);
      expect(body.signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ signal_name: 'bus_v', source: 'PDM' }),
          expect.objectContaining({ signal_name: 'soc', source: 'BMS_SOE' }),
        ])
      );
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/sessions/:id updates metadata', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/sessions/${seed.sessionId}`,
        payload: { notes: 'wet track', car: 'NFR26' },
      });
      expect(res.statusCode).toBe(200);

      const after = await app.inject({
        method: 'GET',
        url: `/api/sessions/${seed.sessionId}`,
      });
      expect(after.json()).toMatchObject({ notes: 'wet track', car: 'NFR26' });
    } finally {
      await app.close();
    }
  });

  it('GET /api/sessions/:id/overview returns bucketed averages', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${seed.sessionId}/overview?bucket=30`,
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json();
      expect(rows).toHaveLength(4); // 2 buckets × 2 signals
      for (const r of rows) {
        expect(r).toMatchObject({
          bucket: expect.any(String),
          signal_id: expect.any(Number),
          avg_value: expect.any(Number),
        });
      }
    } finally {
      await app.close();
    }
  });

  it('DELETE /api/sessions/:id cascades reading deletes', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/sessions/${seed.sessionId}`,
      });
      expect(res.statusCode).toBe(204);

      const { rows } = await pool.query(
        'SELECT count(*)::int AS c FROM sd_readings WHERE session_id = $1',
        [seed.sessionId]
      );
      expect(rows[0].c).toBe(0);

      const list = await app.inject({ method: 'GET', url: '/api/sessions' });
      expect(list.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 3: Write failing test for signals routes**

Create `desktop/main/tests/server/signals.test.ts`:

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

describe('signals API', () => {
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

  it('GET /api/signal-definitions returns all signals', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/signal-definitions' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBeGreaterThanOrEqual(2);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ signal_name: 'bus_v' }),
          expect.objectContaining({ signal_name: 'soc' }),
        ])
      );
    } finally {
      await app.close();
    }
  });

  it('GET /api/signals/:id/window returns raw rows inside the window', async () => {
    const app = await buildApp({ pool });
    try {
      const start = new Date(seed.baseTs.getTime() + 10_000).toISOString();
      const end = new Date(seed.baseTs.getTime() + 20_000).toISOString();
      const res = await app.inject({
        method: 'GET',
        url: `/api/signals/${seed.signalAId}/window?session=${seed.sessionId}&start=${start}&end=${end}`,
      });
      expect(res.statusCode).toBe(200);
      const rows = res.json();
      expect(rows).toHaveLength(11);
      expect(rows[0].value).toBe(10);
      expect(rows[rows.length - 1].value).toBe(20);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 4: Run all new tests — expect failures (route handlers missing)**

- [ ] **Step 5: Implement `desktop/main/src/db/sessions.ts`**

```ts
import type pg from 'pg';

export interface Session {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
  source: 'live' | 'sd_import';
  source_file: string | null;
  synced_at: string | null;
}

export interface SessionDetail extends Session {
  signals: Array<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>;
}

export interface OverviewRow {
  bucket: string;
  signal_id: number;
  avg_value: number;
}

export async function listSessions(pool: pg.Pool): Promise<Session[]> {
  const { rows } = await pool.query<Session>(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, synced_at
     FROM sessions
     ORDER BY started_at DESC`
  );
  return rows;
}

export async function getSession(
  pool: pg.Pool,
  id: string
): Promise<SessionDetail | null> {
  const { rows } = await pool.query<Session>(
    `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
            source, source_file, synced_at
     FROM sessions WHERE id = $1`,
    [id]
  );
  if (rows.length === 0) return null;

  const sigs = await pool.query<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>(
    `SELECT signal_id, source, signal_name, unit FROM get_session_signals($1)`,
    [id]
  );
  return { ...rows[0], signals: sigs.rows };
}

export type SessionPatch = Partial<
  Pick<Session, 'track' | 'driver' | 'car' | 'notes'>
>;

export async function updateSession(
  pool: pg.Pool,
  id: string,
  patch: SessionPatch
): Promise<void> {
  const fields = (['track', 'driver', 'car', 'notes'] as const).filter(
    (k) => k in patch
  );
  if (fields.length === 0) return;

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map((f) => patch[f] ?? null);
  await pool.query(
    `UPDATE sessions SET ${sets} WHERE id = $1`,
    [id, ...values]
  );
}

export async function deleteSession(pool: pg.Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function getSessionOverview(
  pool: pg.Pool,
  id: string,
  bucketSecs: number
): Promise<OverviewRow[]> {
  const { rows } = await pool.query<{
    bucket: Date;
    signal_id: number;
    avg_value: string;
  }>(
    `SELECT bucket, signal_id, avg_value FROM get_session_overview($1, $2) ORDER BY bucket, signal_id`,
    [id, bucketSecs]
  );
  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    signal_id: r.signal_id,
    avg_value: Number(r.avg_value),
  }));
}
```

- [ ] **Step 6: Implement `desktop/main/src/db/signals.ts`**

```ts
import type pg from 'pg';

export interface SignalDefinition {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  description: string | null;
}

export interface WindowRow {
  ts: string;
  value: number;
}

export async function listSignalDefinitions(
  pool: pg.Pool
): Promise<SignalDefinition[]> {
  const { rows } = await pool.query<SignalDefinition>(
    `SELECT id, source, signal_name, unit, description
     FROM signal_definitions
     ORDER BY source, signal_name`
  );
  return rows;
}

export async function getSignalWindow(
  pool: pg.Pool,
  sessionId: string,
  signalId: number,
  start: string,
  end: string
): Promise<WindowRow[]> {
  const { rows } = await pool.query<{ ts: Date; value: string }>(
    `SELECT ts, value FROM get_signal_window($1, $2::smallint, $3::timestamptz, $4::timestamptz)`,
    [sessionId, signalId, start, end]
  );
  return rows.map((r) => ({ ts: r.ts.toISOString(), value: Number(r.value) }));
}
```

- [ ] **Step 7: Implement `desktop/main/src/server/routes/sessions.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  deleteSession,
  getSession,
  getSessionOverview,
  listSessions,
  updateSession,
  type SessionPatch,
} from '../../db/sessions.ts';

export function registerSessionRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/sessions', async () => listSessions(pool));

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const detail = await getSession(pool, req.params.id);
    if (!detail) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return detail;
  });

  app.patch<{ Params: { id: string }; Body: SessionPatch }>(
    '/api/sessions/:id',
    async (req) => {
      await updateSession(pool, req.params.id, req.body ?? {});
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (req, reply) => {
      await deleteSession(pool, req.params.id);
      reply.code(204);
      return;
    }
  );

  app.get<{ Params: { id: string }; Querystring: { bucket?: string } }>(
    '/api/sessions/:id/overview',
    async (req) => {
      const bucket = Number(req.query.bucket ?? '10');
      return getSessionOverview(pool, req.params.id, bucket);
    }
  );
}
```

- [ ] **Step 8: Implement `desktop/main/src/server/routes/signals.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getSignalWindow, listSignalDefinitions } from '../../db/signals.ts';

export function registerSignalRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/signal-definitions', async () => listSignalDefinitions(pool));

  app.get<{
    Params: { id: string };
    Querystring: { session: string; start: string; end: string };
  }>(
    '/api/signals/:id/window',
    async (req) => {
      const signalId = Number(req.params.id);
      const { session, start, end } = req.query;
      return getSignalWindow(pool, session, signalId, start, end);
    }
  );
}
```

- [ ] **Step 9: Wire the routes in `desktop/main/src/server/app.ts`**

Edit `buildApp` — add route registrations after the existing `/api/config` handlers:

```ts
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerSignalRoutes } from './routes/signals.ts';
```

And inside `buildApp`:

```ts
  registerSessionRoutes(app, opts.pool);
  registerSignalRoutes(app, opts.pool);
```

Place these calls just before `return app;`.

- [ ] **Step 10: Run all tests — expect all previous + 5 sessions + 2 signals = 10 new passing, 16 prior green**

```bash
cd desktop && npm test
```

- [ ] **Step 11: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/db/sessions.ts desktop/main/src/db/signals.ts \
        desktop/main/src/server/routes/sessions.ts \
        desktop/main/src/server/routes/signals.ts \
        desktop/main/src/server/app.ts \
        desktop/main/tests/server/sessions.test.ts \
        desktop/main/tests/server/signals.test.ts \
        desktop/main/tests/helpers/seed.ts
git commit -m "feat(desktop): REST endpoints for sessions, signals, overview, window"
```

---

### Task 3: Parser subprocess manager

**Files:**
- Create: `desktop/main/src/parser/protocol.ts`
- Create: `desktop/main/src/parser/manager.ts`
- Create: `desktop/main/tests/parser/manager.test.ts`
- Create: `desktop/main/tests/helpers/fake-parser.ts`

The manager spawns `python parser/__main__.py live ...` as a child process, parses stdout JSON-lines into typed events, emits them via `EventEmitter`, and restarts the process if it exits unexpectedly (with backoff). It supports stop().

- [ ] **Step 1: Create a fake-parser helper — a tiny Node script we can spawn to simulate parser output**

Create `desktop/main/tests/helpers/fake-parser.ts`:

```ts
/**
 * When executed (via `tsx` or `node --loader tsx`), this script prints a
 * scripted sequence of JSON-line events and exits. Used by parser-manager
 * tests to simulate real parser output without needing Python/Postgres.
 *
 * Usage: `tsx fake-parser.ts <name-of-scenario>`
 */
const scenario = process.argv[2];

function emit(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (scenario === 'single-session') {
    emit({ type: 'serial_status', state: 'connected', port: '/dev/ttyFAKE' });
    emit({ type: 'session_started', session_id: 'abc-123', source: 'live' });
    emit({
      type: 'frames',
      rows: [
        { ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 12.3 },
        { ts: '2026-04-22T12:00:01Z', signal_id: 1, value: 12.4 },
      ],
    });
    await sleep(10);
    emit({ type: 'session_ended', session_id: 'abc-123', row_count: 2 });
    emit({ type: 'serial_status', state: 'disconnected' });
    return;
  }

  if (scenario === 'error-then-exit') {
    emit({ type: 'error', msg: 'boom' });
    process.exit(1);
  }

  if (scenario === 'garbled-lines') {
    // Mix of valid events and malformed lines the manager should skip.
    process.stdout.write('this is not json\n');
    emit({ type: 'serial_status', state: 'connected', port: '/dev/ttyX' });
    process.stdout.write('{"type":"partial\n');
    emit({ type: 'error', msg: 'recovered' });
    return;
  }

  if (scenario === 'hang') {
    await new Promise(() => {}); // never resolves — rely on stop() to kill
  }
}

main().catch((e) => {
  process.stderr.write(String(e) + '\n');
  process.exit(2);
});
```

- [ ] **Step 2: Write failing tests for the manager**

Create `desktop/main/tests/parser/manager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { ParserManager } from '../../src/parser/manager.ts';
import type { ParserEvent } from '../../src/parser/protocol.ts';

const FAKE_PARSER = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../helpers/fake-parser.ts'
);

function collectEvents(mgr: ParserManager): Promise<ParserEvent[]> {
  return new Promise((resolve) => {
    const events: ParserEvent[] = [];
    mgr.on('event', (e) => events.push(e));
    mgr.on('exit', () => resolve(events));
  });
}

describe('ParserManager', () => {
  it('parses a scripted session from stdout JSON lines', async () => {
    const mgr = new ParserManager({
      command: 'npx',
      args: ['-y', 'tsx', FAKE_PARSER, 'single-session'],
      restartOnExit: false,
    });

    const eventsP = collectEvents(mgr);
    mgr.start();
    const events = await eventsP;

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'serial_status',
      'session_started',
      'frames',
      'session_ended',
      'serial_status',
    ]);
    const frames = events.find((e) => e.type === 'frames');
    expect(frames && frames.type === 'frames' && frames.rows).toHaveLength(2);
  }, 30_000);

  it('skips malformed stdout lines without crashing', async () => {
    const mgr = new ParserManager({
      command: 'npx',
      args: ['-y', 'tsx', FAKE_PARSER, 'garbled-lines'],
      restartOnExit: false,
    });

    const eventsP = collectEvents(mgr);
    mgr.start();
    const events = await eventsP;

    const types = events.map((e) => e.type);
    expect(types).toEqual(['serial_status', 'error']);
  }, 30_000);

  it('stop() terminates a running process and prevents restart', async () => {
    const mgr = new ParserManager({
      command: 'npx',
      args: ['-y', 'tsx', FAKE_PARSER, 'hang'],
      restartOnExit: true,
      restartDelayMs: 50,
    });

    mgr.start();
    // Give it a moment to spawn.
    await new Promise((r) => setTimeout(r, 500));
    const exited = new Promise<void>((resolve) =>
      mgr.on('exit', () => resolve())
    );
    await mgr.stop();
    await exited;
    expect(mgr.running).toBe(false);
  }, 30_000);
});
```

- [ ] **Step 3: Run — expect failures (no ParserManager / protocol yet)**

- [ ] **Step 4: Implement `desktop/main/src/parser/protocol.ts`**

```ts
export type ParserEvent =
  | { type: 'serial_status'; state: 'connected' | 'disconnected'; port?: string }
  | { type: 'session_started'; session_id: string; source: 'live' | 'sd_import' }
  | { type: 'session_ended'; session_id: string; row_count: number }
  | { type: 'frames'; rows: Array<{ ts: string; signal_id: number; value: number }> }
  | { type: 'import_progress'; file: string; pct: number }
  | { type: 'error'; msg: string };

/** Parse one line from the parser subprocess. Returns null on malformed input. */
export function parseLine(line: string): ParserEvent | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
      return obj as ParserEvent;
    }
  } catch {
    /* fall through */
  }
  return null;
}
```

- [ ] **Step 5: Implement `desktop/main/src/parser/manager.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { parseLine, type ParserEvent } from './protocol.ts';

export interface ParserManagerOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  restartOnExit?: boolean;
  restartDelayMs?: number;
}

/**
 * Spawn and manage a parser subprocess. Emits:
 *   - 'event' (ParserEvent) — one per successfully-parsed stdout line
 *   - 'stderr' (string) — one per line of stderr
 *   - 'exit' (code: number | null, signal: NodeJS.Signals | null)
 *   - 'restart' () — fired just before re-spawning
 */
export class ParserManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopRequested = false;
  private buf = '';
  private stderrBuf = '';

  constructor(private opts: ParserManagerOptions) {
    super();
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  start(): void {
    if (this.running) return;
    this.stopRequested = false;
    this.spawn();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (!this.child) return;
    const child = this.child;
    return new Promise((resolve) => {
      const done = () => resolve();
      if (child.exitCode !== null) return done();
      child.once('close', done);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2_000);
    });
  }

  private spawn(): void {
    const child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.onStderr(chunk));
    child.on('close', (code, signal) => {
      // Flush any trailing buffer as a best-effort parse.
      if (this.buf.length > 0) {
        const ev = parseLine(this.buf);
        if (ev) this.emit('event', ev);
        this.buf = '';
      }
      this.child = null;
      this.emit('exit', code, signal);
      if (!this.stopRequested && this.opts.restartOnExit) {
        this.emit('restart');
        setTimeout(
          () => this.spawn(),
          this.opts.restartDelayMs ?? 1_000
        );
      }
    });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      const ev = parseLine(line);
      if (ev) this.emit('event', ev);
    }
  }

  private onStderr(chunk: string): void {
    this.stderrBuf += chunk;
    let idx: number;
    while ((idx = this.stderrBuf.indexOf('\n')) !== -1) {
      const line = this.stderrBuf.slice(0, idx);
      this.stderrBuf = this.stderrBuf.slice(idx + 1);
      if (line) this.emit('stderr', line);
    }
  }
}
```

- [ ] **Step 6: Run — expect 3 passing. The `hang` scenario uses `stop()` to kill.**

If any test is flaky due to `npx -y tsx` download latency, allow up to `timeout: 60_000` per test.

- [ ] **Step 7: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/parser/protocol.ts \
        desktop/main/src/parser/manager.ts \
        desktop/main/tests/parser/manager.test.ts \
        desktop/main/tests/helpers/fake-parser.ts
git commit -m "feat(desktop): ParserManager subprocess with JSON-line event stream"
```

---

### Task 4: WebSocket channels + server integration

**Files:**
- Create: `desktop/main/src/server/ws.ts`
- Create: `desktop/main/src/server/routes/live.ts`
- Create: `desktop/main/tests/server/ws.test.ts`
- Modify: `desktop/main/src/server/app.ts`

Wires the ParserManager's `event` stream into two WebSocket channels:
- `/ws/live` — pushes every `frames` event to subscribers.
- `/ws/events` — pushes every other event (serial_status, session_started, session_ended, import_progress, error).

Also adds `GET /api/live/status` (reads the latest in-memory state).

- [ ] **Step 1: Write failing WS test**

Create `desktop/main/tests/server/ws.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import pg from 'pg';
import WebSocket from 'ws';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { buildApp } from '../../src/server/app.ts';
import type { ParserEvent } from '../../src/parser/protocol.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

class FakeParser extends EventEmitter {
  emitEvent(e: ParserEvent) {
    this.emit('event', e);
  }
}

async function waitForMessage<T = unknown>(ws: WebSocket): Promise<T> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data))));
  });
}

describe('WebSocket channels', () => {
  let db: ScratchDb | null = null;

  afterAll(async () => {
    if (db) await db.drop();
  });

  it('fans out frames events on /ws/live and meta events on /ws/events', async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    const pool = new pg.Pool({ connectionString: db.url, max: 3 });
    const parser = new FakeParser();

    const app = await buildApp({ pool, parser: parser as unknown as EventEmitter });
    const { port } = (await app.listen({ port: 0, host: '127.0.0.1' })) as unknown as URL; // not used
    const address = app.server.address();
    const actualPort =
      typeof address === 'object' && address ? address.port : 0;

    try {
      const live = new WebSocket(`ws://127.0.0.1:${actualPort}/ws/live`);
      const events = new WebSocket(`ws://127.0.0.1:${actualPort}/ws/events`);
      await Promise.all([
        new Promise((r) => live.once('open', r)),
        new Promise((r) => events.once('open', r)),
      ]);

      const liveMsgP = waitForMessage<{ type: string }>(live);
      const metaMsgP = waitForMessage<{ type: string }>(events);

      parser.emitEvent({
        type: 'frames',
        rows: [{ ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 9.9 }],
      });
      parser.emitEvent({
        type: 'serial_status',
        state: 'connected',
        port: '/dev/ttyFAKE',
      });

      const [liveMsg, metaMsg] = await Promise.all([liveMsgP, metaMsgP]);
      expect(liveMsg.type).toBe('frames');
      expect(metaMsg.type).toBe('serial_status');

      live.close();
      events.close();
    } finally {
      await app.close();
      await pool.end();
    }
  }, 30_000);

  it('GET /api/live/status reflects latest serial + session state from parser events', async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    const pool = new pg.Pool({ connectionString: db.url, max: 3 });
    const parser = new FakeParser();
    const app = await buildApp({ pool, parser: parser as unknown as EventEmitter });

    try {
      parser.emitEvent({ type: 'serial_status', state: 'connected', port: '/dev/ttyFAKE' });
      parser.emitEvent({ type: 'session_started', session_id: 'abc', source: 'live' });

      const res = await app.inject({ method: 'GET', url: '/api/live/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        basestation: 'connected',
        session_id: 'abc',
        port: '/dev/ttyFAKE',
      });

      parser.emitEvent({ type: 'session_ended', session_id: 'abc', row_count: 5 });
      parser.emitEvent({ type: 'serial_status', state: 'disconnected' });

      const res2 = await app.inject({ method: 'GET', url: '/api/live/status' });
      expect(res2.json()).toMatchObject({
        basestation: 'disconnected',
        session_id: null,
      });
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
```

- [ ] **Step 2: Implement `desktop/main/src/server/ws.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'events';
import type { ParserEvent } from '../parser/protocol.ts';

type LiveSocket = { send: (data: string) => void; readyState: number };

export function registerWebSockets(
  app: FastifyInstance,
  parser: EventEmitter
): void {
  const liveClients = new Set<LiveSocket>();
  const eventClients = new Set<LiveSocket>();

  parser.on('event', (e: ParserEvent) => {
    const encoded = JSON.stringify(e);
    const target = e.type === 'frames' ? liveClients : eventClients;
    for (const sock of target) {
      if (sock.readyState === 1 /* OPEN */) {
        sock.send(encoded);
      }
    }
  });

  app.register(async (inner) => {
    inner.get('/ws/live', { websocket: true }, (socket) => {
      liveClients.add(socket as unknown as LiveSocket);
      socket.on('close', () => liveClients.delete(socket as unknown as LiveSocket));
    });

    inner.get('/ws/events', { websocket: true }, (socket) => {
      eventClients.add(socket as unknown as LiveSocket);
      socket.on('close', () => eventClients.delete(socket as unknown as LiveSocket));
    });
  });
}
```

- [ ] **Step 3: Implement `desktop/main/src/server/routes/live.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'events';
import type { ParserEvent } from '../../parser/protocol.ts';

export interface LiveStatus {
  basestation: 'connected' | 'disconnected';
  port: string | null;
  session_id: string | null;
  source: 'live' | 'sd_import' | null;
}

export function registerLiveRoutes(app: FastifyInstance, parser: EventEmitter) {
  const state: LiveStatus = {
    basestation: 'disconnected',
    port: null,
    session_id: null,
    source: null,
  };

  parser.on('event', (e: ParserEvent) => {
    if (e.type === 'serial_status') {
      state.basestation = e.state;
      state.port = e.port ?? null;
    } else if (e.type === 'session_started') {
      state.session_id = e.session_id;
      state.source = e.source;
    } else if (e.type === 'session_ended') {
      state.session_id = null;
      state.source = null;
    }
  });

  app.get('/api/live/status', async () => state);
}
```

- [ ] **Step 4: Modify `desktop/main/src/server/app.ts`**

Update the imports and `BuildAppOptions`:

```ts
import type { EventEmitter } from 'events';
import websocketPlugin from '@fastify/websocket';
import { registerWebSockets } from './ws.ts';
import { registerLiveRoutes } from './routes/live.ts';

export interface BuildAppOptions {
  pool: pg.Pool;
  parser?: EventEmitter;   // optional, so non-live tests don't need it
  logger?: boolean;
}
```

Inside `buildApp`, register the websocket plugin before any WS routes and pass the parser to the registrars:

```ts
  await app.register(websocketPlugin);

  if (opts.parser) {
    registerWebSockets(app, opts.parser);
    registerLiveRoutes(app, opts.parser);
  }
```

Place these before `registerSessionRoutes(app, opts.pool);`.

- [ ] **Step 5: Run — expect 2 new ws tests passing + existing suite green**

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/server/ws.ts \
        desktop/main/src/server/routes/live.ts \
        desktop/main/src/server/app.ts \
        desktop/main/tests/server/ws.test.ts
git commit -m "feat(desktop): WS /ws/live + /ws/events + /api/live/status"
```

---

### Task 5: Folder watcher + SD-import queue

**Files:**
- Create: `desktop/main/src/watcher/queue.ts`
- Create: `desktop/main/src/watcher/watcher.ts`
- Create: `desktop/main/tests/watcher/queue.test.ts`
- Create: `desktop/main/tests/watcher/watcher.test.ts`

The watcher observes a configured directory for new `*.nfr` files, dedupes against `sessions.source_file`, and enqueues one-at-a-time batch imports. Each import invocation spawns `python parser/__main__.py batch --dbc <csv> --file <path>`.

- [ ] **Step 1: Write failing queue test**

Create `desktop/main/tests/watcher/queue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ImportQueue } from '../../src/watcher/queue.ts';

describe('ImportQueue', () => {
  it('runs jobs serially', async () => {
    const running: string[] = [];
    const q = new ImportQueue(async (file) => {
      running.push(`start:${file}`);
      await new Promise((r) => setTimeout(r, 20));
      running.push(`end:${file}`);
    });

    q.enqueue('a.nfr');
    q.enqueue('b.nfr');
    await q.drain();

    expect(running).toEqual(['start:a.nfr', 'end:a.nfr', 'start:b.nfr', 'end:b.nfr']);
  });

  it('continues after a job throws', async () => {
    const processed: string[] = [];
    const q = new ImportQueue(async (file) => {
      if (file === 'bad') throw new Error('nope');
      processed.push(file);
    });
    q.enqueue('good1');
    q.enqueue('bad');
    q.enqueue('good2');
    await q.drain();
    expect(processed).toEqual(['good1', 'good2']);
  });
});
```

- [ ] **Step 2: Implement `desktop/main/src/watcher/queue.ts`**

```ts
type Job = (file: string) => Promise<void>;

export class ImportQueue {
  private pending: string[] = [];
  private draining: Promise<void> = Promise.resolve();
  private idle = true;

  constructor(private run: Job) {}

  enqueue(file: string): void {
    this.pending.push(file);
    if (this.idle) this.startDrain();
  }

  drain(): Promise<void> {
    return this.draining;
  }

  private startDrain(): void {
    this.idle = false;
    this.draining = (async () => {
      while (this.pending.length > 0) {
        const file = this.pending.shift()!;
        try {
          await this.run(file);
        } catch {
          /* surfaced via stderr / parser event emit path */
        }
      }
      this.idle = true;
    })();
  }
}
```

- [ ] **Step 3: Write failing watcher test**

Create `desktop/main/tests/watcher/watcher.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { join as joinPath } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { FolderWatcher } from '../../src/watcher/watcher.ts';

const MIGRATIONS_DIR = joinPath(
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
          // Record the "import" by inserting a session row with matching source_file.
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

      // Restart: the same files should be skipped.
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
```

- [ ] **Step 4: Implement `desktop/main/src/watcher/watcher.ts`**

```ts
import chokidar, { type FSWatcher } from 'chokidar';
import type pg from 'pg';
import { ImportQueue } from './queue.ts';

export interface FolderWatcherOptions {
  dir: string;
  pool: pg.Pool;
  importer: (file: string) => Promise<void>;
}

export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private queue: ImportQueue;
  private seen = new Set<string>();

  constructor(private opts: FolderWatcherOptions) {
    this.queue = new ImportQueue(async (file) => {
      await this.opts.importer(file);
      this.seen.add(file);
    });
  }

  async start(): Promise<void> {
    // Seed `seen` with already-imported files so we don't re-import on boot.
    const { rows } = await this.opts.pool.query<{ source_file: string }>(
      `SELECT source_file FROM sessions WHERE source = 'sd_import' AND source_file IS NOT NULL`
    );
    for (const r of rows) this.seen.add(r.source_file);

    this.watcher = chokidar.watch(this.opts.dir, {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignored: (path: string) =>
        !/\.(nfr|NFR)$/.test(path) && path !== this.opts.dir,
    });

    this.watcher.on('add', (path: string) => {
      if (this.seen.has(path)) return;
      this.seen.add(path);
      this.queue.enqueue(path);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    await this.queue.drain();
  }
}
```

- [ ] **Step 5: Run — expect 3 passing (2 queue + 1 watcher)**

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/watcher/queue.ts \
        desktop/main/src/watcher/watcher.ts \
        desktop/main/tests/watcher/queue.test.ts \
        desktop/main/tests/watcher/watcher.test.ts
git commit -m "feat(desktop): folder watcher + SD-import queue for .nfr files"
```

---

### Task 6: Broadcast mode + token auth

**Files:**
- Create: `desktop/main/src/server/auth.ts`
- Create: `desktop/main/tests/server/auth.test.ts`
- Modify: `desktop/main/src/server/app.ts`

Adds a token auth hook: if a token has been set (broadcast is on), every `/api/*` and `/ws/*` request must supply it via `?key=<token>` or `Authorization: Bearer <token>`. Token is nullable; when null, no check runs. This keeps the local renderer (which doesn't pass a token) working in non-broadcast mode.

- [ ] **Step 1: Write failing test**

Create `desktop/main/tests/server/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { buildApp } from '../../src/server/app.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('auth token', () => {
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

  it('allows all /api/* requests when token is null (default)', async () => {
    const app = await buildApp({ pool, authToken: null });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects /api/* without token when auth is enabled', async () => {
    const app = await buildApp({ pool, authToken: 'secret123' });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('accepts ?key= query param', async () => {
    const app = await buildApp({ pool, authToken: 'secret123' });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health?key=secret123',
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('accepts Authorization: Bearer header', async () => {
    const app = await buildApp({ pool, authToken: 'secret123' });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { authorization: 'Bearer secret123' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Implement `desktop/main/src/server/auth.ts`**

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * When `token` is non-null, every /api/* and /ws/* request must carry the
 * matching token, supplied either as `?key=<token>` or as an
 * `Authorization: Bearer <token>` header. Other paths (e.g. /static/*) are
 * unaffected.
 */
export function registerAuth(app: FastifyInstance, token: string | null): void {
  if (!token) return;

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url;
    if (!url.startsWith('/api/') && !url.startsWith('/ws/')) return;

    const query = req.query as Record<string, string | undefined>;
    const header = req.headers.authorization;
    const supplied =
      query.key ??
      (header && header.startsWith('Bearer ') ? header.slice(7) : undefined);

    if (supplied !== token) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
```

- [ ] **Step 3: Modify `desktop/main/src/server/app.ts`**

Add `authToken?: string | null` to `BuildAppOptions`, and inside `buildApp` call `registerAuth(app, opts.authToken ?? null)` as the very first thing after the Fastify instance is created.

- [ ] **Step 4: Run all tests — expect 4 new auth tests passing; everything else remains green**

- [ ] **Step 5: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/server/auth.ts \
        desktop/main/src/server/app.ts \
        desktop/main/tests/server/auth.test.ts
git commit -m "feat(desktop): token-based auth for broadcast mode"
```

---

### Task 7: Parser replay mode (file → live-style source)

**Purpose:** Let a user exercise the full live stack (auto-session, DB writes, `/ws/live` fan-out, dashboard UI) without a basestation plugged in, by replaying a pre-recorded `.nfr` log file at real-time (or sped-up) pacing. The live loop already consumes an abstract `SourceEvent` iterator; we just add a file-backed implementation and a new `replay` subcommand.

**Files:**
- Create: `parser/file_source.py`
- Modify: `parser/__main__.py` (add `replay` subcommand)
- Create: `parser/tests/test_file_source.py`
- Create: `parser/tests/test_replay_integration.py`
- Modify: `parser/pyproject.toml` (add `file_source` to `py-modules`)
- Modify: `desktop/main/src/index.ts` (read `replayFile` + `replaySpeed` from config; choose parser argv accordingly)

- [ ] **Step 1: Write failing tests for `file_source`**

Create `parser/tests/test_file_source.py`:

```python
"""Tests for parser.file_source — .nfr file → SourceEvent stream."""
from __future__ import annotations

import struct
import time
from pathlib import Path

from file_source import file_events
from nfr_reader import HEADER_SIZE


def _build_log(tmp_path: Path, frames: list[tuple[int, int, bytes]]) -> Path:
    header = bytes([0] * 9) + struct.pack("<BBBB", 3, 4, 22, 26) + struct.pack(
        "<BBBI", 12, 0, 0, 0
    )
    body = bytearray()
    for ts_ms, frame_id, data in frames:
        dlc = len(data)
        body += struct.pack("<IIH", ts_ms, frame_id, dlc)
        body += data + b"\x00" * (8 - dlc)
    log = tmp_path / "LOG.NFR"
    log.write_bytes(header + bytes(body))
    return log


def test_file_events_yields_connected_frames_disconnected(tmp_path: Path) -> None:
    log = _build_log(tmp_path, [(0, 0x123, b"\x01"), (10, 0x456, b"\x02")])
    events = list(file_events(log, speed=0.0))
    kinds = [e.kind for e in events]
    assert kinds == ["connected", "frame", "frame", "disconnected"]
    assert events[1].frame_id == 0x123
    assert events[1].ts_ms == 0
    assert events[2].frame_id == 0x456
    assert events[2].ts_ms == 10


def test_file_events_at_speed_zero_has_no_delay(tmp_path: Path) -> None:
    # 5 frames, 1 second apart if speed=1.0. With speed=0.0, should finish instantly.
    frames = [(i * 1000, 0x123, b"\x01") for i in range(5)]
    log = _build_log(tmp_path, frames)
    start = time.monotonic()
    events = list(file_events(log, speed=0.0))
    elapsed = time.monotonic() - start
    assert elapsed < 0.2
    # connected + 5 frames + disconnected = 7
    assert len(events) == 7


def test_file_events_respects_speed_multiplier(tmp_path: Path) -> None:
    # Two frames 500 ms apart at speed=10.0 → ~50 ms actual delay.
    frames = [(0, 0x123, b"\x01"), (500, 0x123, b"\x02")]
    log = _build_log(tmp_path, frames)
    start = time.monotonic()
    events = list(file_events(log, speed=10.0))
    elapsed = time.monotonic() - start
    # Expect roughly 50 ms. Allow generous bounds for CI variability.
    assert 0.02 < elapsed < 0.5
    assert len(events) == 4  # connected + 2 frames + disconnected
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/parser
.venv/bin/pytest tests/test_file_source.py -v
```

- [ ] **Step 3: Implement `parser/file_source.py`**

```python
"""Convert an .nfr log file into a SourceEvent stream with paced timestamps.

Use this in place of `serial_source.serial_events` when testing the live
stack without a basestation. Speed controls the playback rate:
  - speed == 1.0  → real time (frames emerge at their recorded cadence)
  - speed == 10.0 → 10x faster than real time
  - speed == 0.0  → no delay (flood as fast as possible; good for CI smoke)
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Iterator

from live import SourceEvent
from nfr_reader import iter_frames


def file_events(path: Path, speed: float = 1.0) -> Iterator[SourceEvent]:
    if speed < 0:
        raise ValueError(f"speed must be >= 0, got {speed!r}")

    yield SourceEvent(kind="connected", port=f"file://{path}")

    prev_ts_ms: int | None = None
    wall_start = time.monotonic()
    first_ts_ms: int | None = None

    for ts_ms, frame_id, data in iter_frames(path):
        if speed > 0:
            if first_ts_ms is None:
                first_ts_ms = ts_ms
            # Target wall-clock offset from wall_start for this frame.
            target_offset = (ts_ms - first_ts_ms) / 1000.0 / speed
            now_offset = time.monotonic() - wall_start
            sleep_for = target_offset - now_offset
            if sleep_for > 0:
                time.sleep(sleep_for)
        prev_ts_ms = ts_ms
        yield SourceEvent(
            kind="frame", ts_ms=ts_ms, frame_id=frame_id, data=data
        )

    yield SourceEvent(kind="disconnected")
    _ = prev_ts_ms  # retained for clarity; value is available if callers want it later
```

- [ ] **Step 4: Run file_source tests — expect 3 passing**

- [ ] **Step 5: Add `file_source` to `parser/pyproject.toml`**

Change the `py-modules` list to:

```toml
py-modules = [
  "compile", "decode", "signalSpec",
  "db", "protocol", "nfr_reader", "batch", "live", "serial_source",
  "file_source",
]
```

Run `cd parser && .venv/bin/pip install -e .` to pick up the new module.

- [ ] **Step 6: Extend `parser/__main__.py` with a `replay` subcommand**

Edit the `_build_parser` function and `main` to add the new subcommand. The full updated file:

```python
"""CLI entrypoint for the NFR 26 parser.

Usage (invoke via the explicit script path; the module is a flat-layout
package so `python -m parser` requires `PYTHONPATH=parser`):

  python parser/__main__.py live   --dbc <csv> --port <device> [--baud 9600]
  python parser/__main__.py batch  --dbc <csv> --file <nfr>
  python parser/__main__.py replay --dbc <csv> --file <nfr> [--speed 1.0]

The DB connection string is read from the `NFR_DB_URL` environment variable
(default: `postgres://postgres@localhost:5432/nfr_local`).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Make sibling modules importable regardless of cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from batch import run_batch_import  # noqa: E402
from file_source import file_events  # noqa: E402
from live import run_live  # noqa: E402
from protocol import ProtocolEmitter  # noqa: E402
from serial_source import serial_events  # noqa: E402


DEFAULT_DSN = "postgres://postgres@localhost:5432/nfr_local"


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="parser")
    sub = p.add_subparsers(dest="mode", required=True)

    live = sub.add_parser("live", help="Read live frames from a serial port.")
    live.add_argument("--dbc", required=True, type=Path)
    live.add_argument("--port", required=True)
    live.add_argument("--baud", type=int, default=9600)

    batch = sub.add_parser("batch", help="Import a single .nfr log file.")
    batch.add_argument("--dbc", required=True, type=Path)
    batch.add_argument("--file", required=True, type=Path)

    replay = sub.add_parser(
        "replay",
        help="Replay an .nfr file through the live stack at a chosen speed.",
    )
    replay.add_argument("--dbc", required=True, type=Path)
    replay.add_argument("--file", required=True, type=Path)
    replay.add_argument("--speed", type=float, default=1.0)

    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    dsn = os.environ.get("NFR_DB_URL", DEFAULT_DSN)
    emitter = ProtocolEmitter(sys.stdout)

    try:
        if args.mode == "live":
            run_live(
                dsn=dsn,
                dbc_csv=args.dbc,
                source=serial_events(args.port, args.baud),
                emitter=emitter,
            )
            return 0
        if args.mode == "batch":
            run_batch_import(
                dsn=dsn, dbc_csv=args.dbc, nfr_file=args.file, emitter=emitter
            )
            return 0
        if args.mode == "replay":
            run_live(
                dsn=dsn,
                dbc_csv=args.dbc,
                source=file_events(args.file, speed=args.speed),
                emitter=emitter,
            )
            return 0
    except Exception as err:  # noqa: BLE001
        emitter.error(str(err))
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 7: Write end-to-end replay integration test**

Create `parser/tests/test_replay_integration.py`:

```python
"""End-to-end: replay an .nfr file through run_live and verify DB state."""
from __future__ import annotations

import io
import json
import struct
from pathlib import Path

import psycopg

from file_source import file_events
from live import run_live
from protocol import ProtocolEmitter


DBC_CSV = """\
Message ID,Message Name,Sender,Signal Name,Start Bit,Size (bits),Factor,Offset,Unit,Data Type
0x123,PDM_Status,PDM,bus_v,0,16,0.01,0,V,Unsigned
"""


def _build_log(tmp_path: Path, frames: list[tuple[int, int, bytes]]) -> Path:
    header = bytes([0] * 9) + struct.pack("<BBBB", 3, 4, 22, 26) + struct.pack(
        "<BBBI", 12, 0, 0, 0
    )
    body = bytearray()
    for ts_ms, frame_id, data in frames:
        dlc = len(data)
        body += struct.pack("<IIH", ts_ms, frame_id, dlc)
        body += data + b"\x00" * (8 - dlc)
    log = tmp_path / "REPLAY.NFR"
    log.write_bytes(header + bytes(body))
    return log


def test_replay_drives_live_session_end_to_end(
    scratch_db: str, tmp_path: Path
) -> None:
    dbc = tmp_path / "dbc.csv"
    dbc.write_text(DBC_CSV)

    # Three frames: bus_v = 10.00, 12.00, 14.00 V
    log = _build_log(
        tmp_path,
        [
            (0, 0x123, struct.pack("<H", 1000) + b"\x00" * 6),
            (10, 0x123, struct.pack("<H", 1200) + b"\x00" * 6),
            (20, 0x123, struct.pack("<H", 1400) + b"\x00" * 6),
        ],
    )

    buf = io.StringIO()
    emitter = ProtocolEmitter(buf)

    summary = run_live(
        dsn=scratch_db,
        dbc_csv=dbc,
        source=file_events(log, speed=0.0),
        emitter=emitter,
    )

    assert summary.sessions_closed == 1
    assert summary.rows_written == 3

    with psycopg.connect(scratch_db) as conn:
        sess = conn.execute(
            "SELECT source, ended_at FROM sessions"
        ).fetchone()
        assert sess[0] == "live"
        assert sess[1] is not None
        sd = conn.execute("SELECT count(*) FROM sd_readings").fetchone()[0]
        rt = conn.execute("SELECT count(*) FROM rt_readings").fetchone()[0]
    assert sd == 3
    assert rt == 0

    events = [json.loads(l) for l in buf.getvalue().strip().splitlines()]
    types = [e["type"] for e in events]
    assert types[0] == "serial_status"
    assert events[0]["state"] == "connected"
    assert "session_started" in types
    assert "frames" in types
    assert "session_ended" in types
    assert types[-1] == "serial_status"
    assert events[-1]["state"] == "disconnected"
```

- [ ] **Step 8: Run full parser suite — expect 20 prior + 3 file_source + 1 replay = 24 passing**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/parser
.venv/bin/pytest -v
```

- [ ] **Step 9: Manually smoke the replay CLI against a real fixture**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS nfr_replay_smoke"
psql -h localhost -U postgres -c "CREATE DATABASE nfr_replay_smoke"
for f in desktop/migrations/*.sql; do
  psql -h localhost -U postgres -d nfr_replay_smoke -f "$f"
done

NFR_DB_URL="postgres://postgres@localhost:5432/nfr_replay_smoke" \
  parser/.venv/bin/python parser/__main__.py replay \
    --dbc NFR26DBC.csv \
    --file parser/testData/3-10-26/LOG_0002.NFR \
    --speed 0.0

psql -h localhost -U postgres -d nfr_replay_smoke -c \
  "SELECT source, ended_at, (SELECT count(*) FROM sd_readings WHERE session_id = sessions.id) AS rows FROM sessions"
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS nfr_replay_smoke"
```

Expected: one `live` session row with nonzero rows (20,322 matches the Plan 2 batch smoke).

- [ ] **Step 10: Wire Plan 3 orchestrator to support replay via config**

Modify `desktop/main/src/index.ts`. In the section that builds the parser command line, extend it to check for `replayFile` and `replaySpeed` in `app_config`:

Current (from Task 7 → now Task 8):
```ts
  const serialPort = typeof cfg.serialPort === 'string' ? cfg.serialPort : null;
  // ...
  const parser = new ParserManager({
    command: PARSER_VENV_PY,
    args: serialPort
      ? [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', serialPort]
      : [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', '/dev/null-no-port-configured'],
```

Change to:
```ts
  const serialPort = typeof cfg.serialPort === 'string' ? cfg.serialPort : null;
  const replayFile = typeof cfg.replayFile === 'string' ? cfg.replayFile : null;
  const replaySpeed =
    typeof cfg.replaySpeed === 'number' ? cfg.replaySpeed : 1.0;

  const parserArgs = replayFile
    ? [
        PARSER_PY,
        'replay',
        '--dbc',
        dbcCsv,
        '--file',
        replayFile,
        '--speed',
        String(replaySpeed),
      ]
    : serialPort
      ? [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', serialPort]
      : [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', '/dev/null-no-port-configured'];

  const parser = new ParserManager({
    command: PARSER_VENV_PY,
    args: parserArgs,
```

Also: when `replayFile` is set, disable `restartOnExit` so the replay finishes cleanly instead of re-running in a loop. Change:

```ts
    restartOnExit: true,
    restartDelayMs: 2_000,
```

to:

```ts
    restartOnExit: !replayFile,
    restartDelayMs: 2_000,
```

- [ ] **Step 11: Run full desktop suite (no new desktop tests — orchestrator change is covered by existing bootstrapping flow)**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/desktop && npm test
```

All Plan 1–3 tests must remain green.

- [ ] **Step 12: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add parser/file_source.py parser/__main__.py parser/pyproject.toml \
        parser/tests/test_file_source.py parser/tests/test_replay_integration.py \
        desktop/main/src/index.ts
git commit -m "feat(parser): add replay mode + orchestrator support via app_config"
```

---

### Task 8: Entry point, Electron shell, manual smoke

**Files:**
- Create: `desktop/main/src/index.ts`
- Create: `desktop/main/src/electron-main.ts`
- Create: `desktop/preload/preload.ts`

Headless entry (`index.ts`) is what `npm run dev:server` executes; it boots the DB, spawns the parser, starts the server, starts the watcher. Electron entry (`electron-main.ts`) is the same plus a BrowserWindow pointed at `http://127.0.0.1:<port>`. Smoke tests are manual — no new automated tests required.

- [ ] **Step 1: Implement `desktop/main/src/index.ts`**

```ts
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bootstrapDatabase } from './db/bootstrap.ts';
import { createPool } from './db/pool.ts';
import { getAppConfig } from './db/config.ts';
import { buildApp } from './server/app.ts';
import { ParserManager } from './parser/manager.ts';
import { FolderWatcher } from './watcher/watcher.ts';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const PARSER_DIR = join(REPO_ROOT, 'parser');
const PARSER_PY = join(PARSER_DIR, '__main__.py');
const PARSER_VENV_PY = join(PARSER_DIR, '.venv', 'bin', 'python');

export async function run(opts: {
  dsn?: string;
  port?: number;
  host?: string;
  dbcCsv?: string;
} = {}) {
  const dsn =
    opts.dsn ??
    process.env.NFR_DB_URL ??
    'postgres://postgres@localhost:5432/nfr_local';
  const host = opts.host ?? process.env.NFR_BIND_HOST ?? '127.0.0.1';
  const port = opts.port ?? Number(process.env.NFR_BIND_PORT ?? '4444');
  const dbcCsv = opts.dbcCsv ?? join(REPO_ROOT, 'NFR26DBC.csv');

  const boot = await bootstrapDatabase({ connectionString: dsn, migrationsDir: MIGRATIONS_DIR });
  await boot.client.end();

  const pool = createPool({ connectionString: dsn });
  const cfg = await getAppConfig(pool);
  const authToken = typeof cfg.authToken === 'string' ? cfg.authToken : null;
  const serialPort = typeof cfg.serialPort === 'string' ? cfg.serialPort : null;
  const watchDir = typeof cfg.watchDir === 'string' ? cfg.watchDir : null;

  const parser = new ParserManager({
    command: PARSER_VENV_PY,
    args: serialPort
      ? [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', serialPort]
      : [PARSER_PY, 'live', '--dbc', dbcCsv, '--port', '/dev/null-no-port-configured'],
    env: { ...process.env, NFR_DB_URL: dsn },
    restartOnExit: true,
    restartDelayMs: 2_000,
  });
  parser.start();

  const app = await buildApp({ pool, parser, authToken });
  await app.listen({ port, host });

  let watcher: FolderWatcher | null = null;
  if (watchDir) {
    watcher = new FolderWatcher({
      dir: watchDir,
      pool,
      importer: async (file: string) => {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            PARSER_VENV_PY,
            [PARSER_PY, 'batch', '--dbc', dbcCsv, '--file', file],
            { env: { ...process.env, NFR_DB_URL: dsn }, stdio: 'inherit' }
          );
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error(`parser batch exit ${code}`))
          );
        });
      },
    });
    await watcher.start();
  }

  const shutdown = async () => {
    await parser.stop();
    if (watcher) await watcher.stop();
    await app.close();
    await pool.end();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { app, pool, parser, watcher, shutdown, host, port };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error('fatal:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Implement `desktop/main/src/electron-main.ts` (shim)**

```ts
/**
 * Electron main entry point. Boots the same server as `index.ts`, then
 * opens a BrowserWindow pointed at it. Kept minimal — we don't want
 * Electron-specific logic leaking into the headless server path.
 */
import { app, BrowserWindow } from 'electron';
import { run } from './index.ts';

let shutdownFn: (() => Promise<void>) | null = null;

app.whenReady().then(async () => {
  const booted = await run();
  shutdownFn = booted.shutdown;

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`http://${booted.host}:${booted.port}`);
});

app.on('window-all-closed', async () => {
  if (shutdownFn) await shutdownFn();
  app.quit();
});
```

- [ ] **Step 3: Create `desktop/preload/preload.ts`**

```ts
/**
 * Minimal preload. Exposes the base URL so the renderer can talk to the
 * local server without hardcoding a port. Broadcast-mode token (if any)
 * is fetched by the renderer via /api/config.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('__nfr__', {
  baseUrl: window.location.origin,
});
```

- [ ] **Step 4: Manual smoke test of the headless server**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations

# Start Postgres database + migrations.
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS nfr_local_smoke3"
psql -h localhost -U postgres -c "CREATE DATABASE nfr_local_smoke3"

# Start the headless server in the background.
export NFR_DB_URL="postgres://postgres@localhost:5432/nfr_local_smoke3"
export NFR_BIND_PORT=4455
cd desktop
(npx tsx main/src/index.ts &) 
SERVER_PID=$!

# Wait for boot.
sleep 3

# Smoke: health, sessions list (should be empty array).
curl -s http://127.0.0.1:4455/api/health
echo
curl -s http://127.0.0.1:4455/api/sessions
echo

# Drop the scratch DB + stop the server.
kill $SERVER_PID 2>/dev/null
psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS nfr_local_smoke3"
```

Expected output:
- `{"status":"ok"}`
- `[]`
- No unhandled errors before we kill it.

- [ ] **Step 5: Run the full desktop test suite**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/desktop
npm test
```

Expect all tests from Plans 1–3 passing. Count should include:
- 18 from Plan 1
- 3 config + 3 app + 5 sessions + 2 signals + 3 manager + 2 ws + 4 auth + 2 queue + 1 watcher = 25 from Plan 3

Total: **43 tests** (approx; Plans 1 tests unchanged).

- [ ] **Step 6: Add electron to dependencies (deferred install — packaging task in Plan 5)**

Do NOT install electron yet. We keep `electron-main.ts` and `preload.ts` as source but don't pull the heavy electron package until Plan 5 when we set up electron-builder. They compile with tsc because the types come from `electron` — for now, keep them in the repo but have `typecheck` skip them.

Append to `desktop/tsconfig.json`'s `exclude` (if present; otherwise add):

```json
  "exclude": ["main/src/electron-main.ts", "preload/**"]
```

If `desktop/tsconfig.json` doesn't have an `exclude` yet, add one at the top-level of the JSON next to `include`.

- [ ] **Step 7: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/index.ts \
        desktop/main/src/electron-main.ts \
        desktop/preload/preload.ts \
        desktop/tsconfig.json
git commit -m "feat(desktop): headless server entry + Electron shell shim"
```

---

## Exit criteria for Plan 3

- `cd desktop && npm test` passes (~43 tests) and `cd parser && .venv/bin/pytest` passes (24 tests total, including 4 new for replay mode).
- `tsx main/src/index.ts` boots a working server that: applies migrations, spawns the parser subprocess (or logs a benign error if no port configured), listens on `127.0.0.1:4444` by default, serves `/api/health`, `/api/sessions`, `/api/signals/:id/window`, `/api/live/status`, `/api/config`, and WS `/ws/live` + `/ws/events`.
- `index.ts` reads `app_config.authToken` and, if non-null, enforces token auth on all `/api/*` and `/ws/*` requests (broadcast mode).
- Setting `replayFile` (and optionally `replaySpeed`) in `app_config` swaps the parser to `replay` mode, driving the live stack from a canned `.nfr` file so the UI in Plan 4 can be reviewed without a basestation.
- `FolderWatcher` enqueues and runs batch imports when configured.
- `electron-main.ts` and `preload/preload.ts` are in the repo but not yet built; Plan 5 handles electron-builder wiring.

Plan 4 (frontend data-layer refactor + FSAE dashboard port) builds against the REST+WS surface in Tasks 2–4 and can run without any further desktop changes.
