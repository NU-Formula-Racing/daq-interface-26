# Plan 1 — Database & Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay down the local Postgres schema and a TypeScript migration runner that the Electron app will call at first-launch bootstrap, plus RPC functions and integration tests against a real Postgres.

**Architecture:** Plain vanilla Postgres (user-installed). A tiny TypeScript module (`runMigrations`) applies numbered SQL files in order inside a transaction each, tracked in a `schema_migrations` table. Tests spin up throwaway databases and run the full migration sequence against them, then verify schema + RPCs produce correct results with fixture data.

**Tech Stack:** PostgreSQL 14+, Node 20+, TypeScript, `pg` (node-postgres), Vitest, `tsx` for running TS tests.

**Prerequisites (developer machine):** Postgres running on `localhost:5432`, with a superuser named `postgres` (or matching env vars). Tests create/drop databases, so the user running tests needs CREATEDB privilege.

---

### Task 1: Scaffold `desktop/` workspace

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`
- Create: `desktop/.gitignore`
- Create: `desktop/vitest.config.ts`
- Create: `desktop/main/src/.gitkeep`
- Create: `desktop/migrations/.gitkeep`
- Create: `desktop/main/tests/.gitkeep`

- [ ] **Step 1: Create `desktop/package.json`**

```json
{
  "name": "daq-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["main/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `desktop/.gitignore`**

```
node_modules/
dist/
*.log
.env
.env.local
```

- [ ] **Step 4: Create `desktop/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['main/tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Create empty placeholder files so git tracks the dirs**

```bash
mkdir -p desktop/main/src desktop/main/tests desktop/migrations
touch desktop/main/src/.gitkeep desktop/main/tests/.gitkeep desktop/migrations/.gitkeep
```

- [ ] **Step 6: Install dependencies**

Run: `cd desktop && npm install`
Expected: packages installed, `package-lock.json` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add desktop/
git commit -m "chore: scaffold desktop workspace"
```

---

### Task 2: Test harness for throwaway Postgres databases

**Files:**
- Create: `desktop/main/tests/helpers/pg.ts`

Every test will need to: (a) connect as an admin user, (b) create a randomly-named database, (c) connect to that DB, (d) drop it on teardown. Centralize that here.

- [ ] **Step 1: Create `desktop/main/tests/helpers/pg.ts`**

```ts
import { Client } from 'pg';
import { randomBytes } from 'crypto';

const ADMIN_URL =
  process.env.TEST_PG_URL ?? 'postgres://postgres@localhost:5432/postgres';

export interface ScratchDb {
  url: string;
  name: string;
  client: Client;
  drop: () => Promise<void>;
}

export async function createScratchDb(): Promise<ScratchDb> {
  const name = `nfr_test_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  return {
    url: url.toString(),
    name,
    client,
    drop: async () => {
      await client.end().catch(() => {});
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      try {
        await a.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
          [name]
        );
        await a.query(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await a.end();
      }
    },
  };
}
```

- [ ] **Step 2: Create smoke test that exercises the harness**

Create: `desktop/main/tests/helpers/pg.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createScratchDb } from './pg.ts';

describe('createScratchDb', () => {
  it('creates and drops a throwaway database', async () => {
    const db = await createScratchDb();
    try {
      const { rows } = await db.client.query<{ datname: string }>(
        `SELECT current_database() as datname`
      );
      expect(rows[0].datname).toBe(db.name);
    } finally {
      await db.drop();
    }
  });
});
```

- [ ] **Step 3: Run test to verify harness works**

Run: `cd desktop && npx vitest run main/tests/helpers/pg.test.ts`
Expected: 1 passing test. If it fails with a connection error, set `TEST_PG_URL` in the shell (e.g. `export TEST_PG_URL=postgres://<user>@localhost:5432/postgres`).

- [ ] **Step 4: Commit**

```bash
git add desktop/main/tests/helpers/
git commit -m "test: add throwaway-postgres test harness"
```

---

### Task 3: Migration runner (TDD)

**Files:**
- Create: `desktop/main/tests/db/migrate.test.ts`
- Create: `desktop/main/src/db/migrate.ts`

- [ ] **Step 1: Write failing test for an empty DB**

Create: `desktop/main/tests/db/migrate.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';

describe('runMigrations', () => {
  let db: ScratchDb;
  let migrationsDir: string;

  beforeEach(async () => {
    db = await createScratchDb();
    migrationsDir = mkdtempSync(join(tmpdir(), 'mig-'));
  });

  afterEach(async () => {
    await db.drop();
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('applies a single migration on a fresh DB and records it', async () => {
    writeFileSync(
      join(migrationsDir, '0001_init.sql'),
      'CREATE TABLE widgets (id INT PRIMARY KEY);'
    );

    await runMigrations(db.client, migrationsDir);

    const { rows: tables } = await db.client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'widgets'`
    );
    expect(tables).toHaveLength(1);

    const { rows: versions } = await db.client.query(
      `SELECT version FROM schema_migrations ORDER BY version`
    );
    expect(versions.map((r) => r.version)).toEqual(['0001_init']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run main/tests/db/migrate.test.ts`
Expected: FAIL — `Cannot find module '../../src/db/migrate.ts'`.

- [ ] **Step 3: Implement minimal runner**

Create: `desktop/main/src/db/migrate.ts`

```ts
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Client } from 'pg';

export async function runMigrations(
  client: Client,
  migrationsDir: string
): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: applied } = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations'
  );
  const appliedSet = new Set(applied.map((r) => r.version));

  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (appliedSet.has(version)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
      await client.query('COMMIT');
      newlyApplied.push(version);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${file} failed: ${(err as Error).message}`
      );
    }
  }
  return newlyApplied;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run main/tests/db/migrate.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: Add test for idempotency (already-applied migrations are skipped)**

Append to `desktop/main/tests/db/migrate.test.ts` inside the `describe` block:

```ts
  it('skips already-applied migrations on re-run', async () => {
    writeFileSync(
      join(migrationsDir, '0001_init.sql'),
      'CREATE TABLE widgets (id INT PRIMARY KEY);'
    );

    const first = await runMigrations(db.client, migrationsDir);
    expect(first).toEqual(['0001_init']);

    const second = await runMigrations(db.client, migrationsDir);
    expect(second).toEqual([]);
  });

  it('applies new migrations on top of existing ones in order', async () => {
    writeFileSync(
      join(migrationsDir, '0001_a.sql'),
      'CREATE TABLE a (id INT PRIMARY KEY);'
    );
    await runMigrations(db.client, migrationsDir);

    writeFileSync(
      join(migrationsDir, '0002_b.sql'),
      'CREATE TABLE b (id INT PRIMARY KEY);'
    );
    const applied = await runMigrations(db.client, migrationsDir);
    expect(applied).toEqual(['0002_b']);

    const { rows } = await db.client.query(
      `SELECT version FROM schema_migrations ORDER BY version`
    );
    expect(rows.map((r) => r.version)).toEqual(['0001_a', '0002_b']);
  });

  it('rolls back a failing migration and reports the failure', async () => {
    writeFileSync(
      join(migrationsDir, '0001_bad.sql'),
      'CREATE TABLE t (id INT PRIMARY KEY); SELECT * FROM no_such_table;'
    );

    await expect(runMigrations(db.client, migrationsDir)).rejects.toThrow(
      /Migration 0001_bad\.sql failed/
    );

    const { rows: tables } = await db.client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 't'`
    );
    expect(tables).toHaveLength(0);

    const { rows: versions } = await db.client.query(
      `SELECT version FROM schema_migrations`
    );
    expect(versions).toEqual([]);
  });
```

- [ ] **Step 6: Run all runner tests**

Run: `cd desktop && npx vitest run main/tests/db/migrate.test.ts`
Expected: 4 passing tests.

- [ ] **Step 7: Commit**

```bash
git add desktop/main/src/db/migrate.ts desktop/main/tests/db/migrate.test.ts
git commit -m "feat: migration runner with idempotency + transactional apply"
```

---

### Task 4: Migration `0001_init.sql` — base tables

**Files:**
- Create: `desktop/migrations/0001_init.sql`
- Create: `desktop/main/tests/db/schema.test.ts`

- [ ] **Step 1: Write failing schema smoke test**

Create: `desktop/main/tests/db/schema.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('schema (after running all migrations)', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
  });

  afterAll(async () => {
    await db.drop();
  });

  it('creates all expected tables', async () => {
    const { rows } = await db.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    const tables = rows.map((r) => r.table_name);
    for (const t of [
      'app_config',
      'rt_readings',
      'schema_migrations',
      'sd_readings',
      'sessions',
      'signal_definitions',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('enforces the sessions.source check constraint', async () => {
    await expect(
      db.client.query(
        `INSERT INTO sessions (date, started_at, source)
         VALUES (CURRENT_DATE, now(), 'bogus')`
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('cascades reading deletes when a session is deleted', async () => {
    await db.client.query(
      `INSERT INTO signal_definitions (source, signal_name, unit)
       VALUES ('TEST', 'sig_a', 'V')`
    );
    const sig = await db.client.query<{ id: number }>(
      `SELECT id FROM signal_definitions WHERE source='TEST' AND signal_name='sig_a'`
    );
    const sid = sig.rows[0].id;

    const sess = await db.client.query<{ id: string }>(
      `INSERT INTO sessions (date, started_at, source)
       VALUES (CURRENT_DATE, now(), 'live')
       RETURNING id`
    );
    const sessionId = sess.rows[0].id;

    await db.client.query(
      `INSERT INTO sd_readings (ts, session_id, signal_id, value)
       VALUES (now(), $1, $2, 1.0)`,
      [sessionId, sid]
    );

    await db.client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
    const { rows: remaining } = await db.client.query(
      `SELECT * FROM sd_readings WHERE session_id = $1`,
      [sessionId]
    );
    expect(remaining).toHaveLength(0);
  });

  it('enforces single-row app_config via CHECK (id=1)', async () => {
    await db.client.query(`INSERT INTO app_config (id) VALUES (1) ON CONFLICT DO NOTHING`);
    await expect(
      db.client.query(`INSERT INTO app_config (id) VALUES (2)`)
    ).rejects.toThrow(/check constraint/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run main/tests/db/schema.test.ts`
Expected: FAIL — no migration files yet.

- [ ] **Step 3: Write migration `0001_init.sql`**

Create: `desktop/migrations/0001_init.sql`

```sql
-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE signal_definitions (
  id           SMALLSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  signal_name  TEXT NOT NULL,
  unit         TEXT,
  description  TEXT,
  UNIQUE (source, signal_name)
);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  track        TEXT,
  driver       TEXT,
  car          TEXT,
  notes        TEXT,
  source       TEXT NOT NULL CHECK (source IN ('live','sd_import')),
  source_file  TEXT,
  synced_at    TIMESTAMPTZ
);
CREATE INDEX sessions_date_idx ON sessions (date);
CREATE INDEX sessions_unsynced_idx ON sessions (synced_at) WHERE synced_at IS NULL;

CREATE TABLE sd_readings (
  ts           TIMESTAMPTZ NOT NULL,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_id    SMALLINT NOT NULL REFERENCES signal_definitions(id),
  value        DOUBLE PRECISION NOT NULL
);
CREATE INDEX sd_readings_lookup_idx ON sd_readings (session_id, signal_id, ts);

CREATE TABLE rt_readings (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_id    SMALLINT NOT NULL REFERENCES signal_definitions(id),
  value        DOUBLE PRECISION NOT NULL
);
CREATE INDEX rt_readings_signal_time_idx ON rt_readings (signal_id, ts DESC);

CREATE TABLE app_config (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Run schema tests to verify they pass**

Run: `cd desktop && npx vitest run main/tests/db/schema.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/migrations/0001_init.sql desktop/main/tests/db/schema.test.ts
git commit -m "feat: add 0001_init migration and schema tests"
```

---

### Task 5: Migration `0002_rpcs.sql` — downsampled, window, signals, overview

**Files:**
- Create: `desktop/migrations/0002_rpcs.sql`
- Create: `desktop/main/tests/db/rpcs.test.ts`
- Create: `desktop/main/tests/helpers/fixtures.ts`

- [ ] **Step 1: Create fixture helper**

Create: `desktop/main/tests/helpers/fixtures.ts`

```ts
import type { Client } from 'pg';

export interface Fixture {
  sessionId: string;
  signalAId: number;
  signalBId: number;
  baseTs: Date;
}

/**
 * Inserts one session with two signals ("A" and "B") and 60 seconds of
 * data (1 Hz), alternating value patterns so averages are predictable.
 */
export async function seedBasicFixture(client: Client): Promise<Fixture> {
  const sigA = await client.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('TEST', 'A', 'V')
     RETURNING id`
  );
  const sigB = await client.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name, unit)
     VALUES ('TEST', 'B', 'A')
     RETURNING id`
  );

  const baseTs = new Date('2026-04-22T12:00:00Z');

  const sess = await client.query<{ id: string }>(
    `INSERT INTO sessions (date, started_at, ended_at, source)
     VALUES ($1::date, $2, $3, 'live')
     RETURNING id`,
    [baseTs, baseTs, new Date(baseTs.getTime() + 60_000)]
  );

  const rows: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (let i = 0; i < 60; i++) {
    const ts = new Date(baseTs.getTime() + i * 1000);
    rows.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(ts, sess.rows[0].id, sigA.rows[0].id, i);
    rows.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(ts, sess.rows[0].id, sigB.rows[0].id, 100 - i);
  }
  await client.query(
    `INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES ${rows.join(',')}`,
    params
  );

  return {
    sessionId: sess.rows[0].id,
    signalAId: sigA.rows[0].id,
    signalBId: sigB.rows[0].id,
    baseTs,
  };
}
```

- [ ] **Step 2: Write failing RPC tests**

Create: `desktop/main/tests/db/rpcs.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { seedBasicFixture, type Fixture } from '../helpers/fixtures.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

describe('RPC functions', () => {
  let db: ScratchDb;
  let f: Fixture;

  beforeAll(async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    f = await seedBasicFixture(db.client);
  });

  afterAll(async () => {
    await db.drop();
  });

  it('get_session_signals returns both signals for the session', async () => {
    const { rows } = await db.client.query(
      `SELECT * FROM get_session_signals($1) ORDER BY signal_name`,
      [f.sessionId]
    );
    expect(rows.map((r) => r.signal_name)).toEqual(['A', 'B']);
    expect(rows[0].source).toBe('TEST');
    expect(rows[0].unit).toBe('V');
  });

  it('get_signal_window returns rows inside the time window, ordered by ts', async () => {
    const start = new Date(f.baseTs.getTime() + 10_000);
    const end = new Date(f.baseTs.getTime() + 20_000);
    const { rows } = await db.client.query(
      `SELECT * FROM get_signal_window($1, $2, $3, $4)`,
      [f.sessionId, f.signalAId, start, end]
    );
    expect(rows).toHaveLength(11); // 10..20 inclusive
    expect(rows[0].value).toBe(10);
    expect(rows[rows.length - 1].value).toBe(20);
  });

  it('get_signal_downsampled buckets to 10-second averages', async () => {
    const { rows } = await db.client.query(
      `SELECT bucket, avg_value FROM get_signal_downsampled($1, $2, INTERVAL '10 seconds')
       ORDER BY bucket`,
      [f.sessionId, f.signalAId]
    );
    // 60 points, values 0..59 → six buckets of 10, avgs 4.5, 14.5, 24.5, 34.5, 44.5, 54.5
    expect(rows).toHaveLength(6);
    const avgs = rows.map((r) => Number(r.avg_value));
    expect(avgs).toEqual([4.5, 14.5, 24.5, 34.5, 44.5, 54.5]);
  });

  it('get_session_overview buckets all signals at once', async () => {
    const { rows } = await db.client.query(
      `SELECT * FROM get_session_overview($1, 30)
       ORDER BY bucket, signal_id`,
      [f.sessionId]
    );
    // Two buckets x two signals = 4 rows
    expect(rows).toHaveLength(4);
    const byKey = new Map(
      rows.map((r) => [`${r.bucket.toISOString()}_${r.signal_id}`, Number(r.avg_value)])
    );
    // First 30-sec bucket: A avg = 14.5, B avg = 85.5; second: A=44.5, B=55.5
    const b0 = new Date(f.baseTs).toISOString();
    const b1 = new Date(f.baseTs.getTime() + 30_000).toISOString();
    expect(byKey.get(`${b0}_${f.signalAId}`)).toBe(14.5);
    expect(byKey.get(`${b0}_${f.signalBId}`)).toBe(85.5);
    expect(byKey.get(`${b1}_${f.signalAId}`)).toBe(44.5);
    expect(byKey.get(`${b1}_${f.signalBId}`)).toBe(55.5);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd desktop && npx vitest run main/tests/db/rpcs.test.ts`
Expected: FAIL — functions don't exist yet.

- [ ] **Step 4: Write migration `0002_rpcs.sql`**

Create: `desktop/migrations/0002_rpcs.sql`

```sql
CREATE OR REPLACE FUNCTION get_session_signals(p_session_id UUID)
RETURNS TABLE (
  signal_id   SMALLINT,
  source      TEXT,
  signal_name TEXT,
  unit        TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT DISTINCT
    sr.signal_id,
    sd.source,
    sd.signal_name,
    sd.unit
  FROM sd_readings sr
  JOIN signal_definitions sd ON sd.id = sr.signal_id
  WHERE sr.session_id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION get_signal_window(
  p_session_id UUID,
  p_signal_id  SMALLINT,
  p_start      TIMESTAMPTZ,
  p_end        TIMESTAMPTZ
)
RETURNS TABLE (
  ts    TIMESTAMPTZ,
  value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT ts, value
  FROM sd_readings
  WHERE session_id = p_session_id
    AND signal_id  = p_signal_id
    AND ts >= p_start
    AND ts <= p_end
  ORDER BY ts;
$$;

CREATE OR REPLACE FUNCTION get_signal_downsampled(
  p_session_id     UUID,
  p_signal_id      SMALLINT,
  p_bucket_interval INTERVAL
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  avg_value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(
      floor(extract(epoch FROM ts) / extract(epoch FROM p_bucket_interval))
      * extract(epoch FROM p_bucket_interval)
    ) AS bucket,
    avg(value) AS avg_value
  FROM sd_readings
  WHERE session_id = p_session_id
    AND signal_id  = p_signal_id
  GROUP BY bucket
  ORDER BY bucket;
$$;

CREATE OR REPLACE FUNCTION get_session_overview(
  p_session_id UUID,
  p_bucket_secs INT
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  signal_id SMALLINT,
  avg_value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM ts) / p_bucket_secs) * p_bucket_secs) AS bucket,
    signal_id,
    avg(value) AS avg_value
  FROM sd_readings
  WHERE session_id = p_session_id
  GROUP BY bucket, signal_id
  ORDER BY bucket, signal_id;
$$;
```

- [ ] **Step 5: Run RPC tests to verify they pass**

Run: `cd desktop && npx vitest run main/tests/db/rpcs.test.ts`
Expected: 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add desktop/migrations/0002_rpcs.sql desktop/main/tests/db/rpcs.test.ts desktop/main/tests/helpers/fixtures.ts
git commit -m "feat: add RPC functions (session_signals, signal_window, downsampled, overview)"
```

---

### Task 6: End-to-end "run all migrations fresh" smoke

**Files:**
- Modify: `desktop/main/tests/db/schema.test.ts`

Verify the full ordered migration sequence ends with a clean schema in a single run. This ensures Task 4 and Task 5 migrations don't conflict when applied together on a truly fresh DB.

- [ ] **Step 1: Append integration test to `schema.test.ts`**

At the bottom of `desktop/main/tests/db/schema.test.ts`, add a new `describe` block:

```ts
describe('applying all migrations on a fresh DB', () => {
  it('produces the expected migration log and callable RPCs', async () => {
    const fresh = await createScratchDb();
    try {
      const applied = await runMigrations(fresh.client, MIGRATIONS_DIR);
      expect(applied).toEqual(['0001_init', '0002_rpcs']);

      // RPCs are callable (no rows for empty DB, but the call must succeed)
      await fresh.client.query(`SELECT * FROM get_session_signals(gen_random_uuid())`);
      await fresh.client.query(
        `SELECT * FROM get_session_overview(gen_random_uuid(), 10)`
      );
    } finally {
      await fresh.drop();
    }
  });
});
```

- [ ] **Step 2: Run the full test suite**

Run: `cd desktop && npm test`
Expected: all tests pass (helper, runner x4, schema x4 + 1 new, rpcs x4 = 14 tests).

- [ ] **Step 3: Commit**

```bash
git add desktop/main/tests/db/schema.test.ts
git commit -m "test: end-to-end fresh-db migration smoke"
```

---

### Task 7: Export a `bootstrapDatabase` helper for the eventual app entrypoint

**Files:**
- Create: `desktop/main/src/db/bootstrap.ts`
- Create: `desktop/main/tests/db/bootstrap.test.ts`

This is the function Electron main will call at first launch: connect, ensure migrations are current, return a ready client. Thin wrapper over `runMigrations`, but keeps the entrypoint contract explicit and tested.

- [ ] **Step 1: Write failing test**

Create: `desktop/main/tests/db/bootstrap.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && npx vitest run main/tests/db/bootstrap.test.ts`
Expected: FAIL — `bootstrap.ts` missing.

- [ ] **Step 3: Implement `bootstrapDatabase`**

Create: `desktop/main/src/db/bootstrap.ts`

```ts
import { Client } from 'pg';
import { runMigrations } from './migrate.ts';

export interface BootstrapOptions {
  connectionString: string;
  migrationsDir: string;
}

export interface BootstrapResult {
  client: Client;
  applied: string[];
}

export async function bootstrapDatabase(
  opts: BootstrapOptions
): Promise<BootstrapResult> {
  const client = new Client({ connectionString: opts.connectionString });
  await client.connect();
  const applied = await runMigrations(client, opts.migrationsDir);
  return { client, applied };
}
```

- [ ] **Step 4: Run bootstrap tests**

Run: `cd desktop && npx vitest run main/tests/db/bootstrap.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Run full suite**

Run: `cd desktop && npm test`
Expected: all tests pass (16 total).

- [ ] **Step 6: Commit**

```bash
git add desktop/main/src/db/bootstrap.ts desktop/main/tests/db/bootstrap.test.ts
git commit -m "feat: bootstrapDatabase entrypoint for Electron main"
```

---

## Exit criteria for Plan 1

All of the following must hold:

- `cd desktop && npm test` passes with 16 tests across 5 files.
- Migration files live in `desktop/migrations/`, numbered and ordered.
- `bootstrapDatabase` is the stable entrypoint the Electron main process (Plan 3) will consume.
- `schema_migrations` tracks applied versions; reruns are idempotent.
- The four RPCs (`get_session_signals`, `get_signal_window`, `get_signal_downsampled`, `get_session_overview`) return correct results against fixture data.

The next plan (Plan 2 — Python parser extensions) will reuse the migration files and the `psycopg` side of this schema without modification.
