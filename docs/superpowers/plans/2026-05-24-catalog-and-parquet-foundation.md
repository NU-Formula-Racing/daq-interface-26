# Catalog + Parquet Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase row storage with Parquet-on-object-storage and prepare both local and cloud schemas to track per-session blobs and content hashes. No user-visible UI yet — this is the data-model foundation that the upload, pull, and web-reads plans build on.

**Architecture:** Add a `session_blobs` table and a `content_hash`/`manifest_key`/`total_bytes` set of columns to `sessions` on both the local embedded Postgres and Supabase. Drop `sd_readings` from Supabase entirely. Introduce a `parquet` module in the desktop that uses the `duckdb` npm package (already a clean fit for Node) to read and write Parquet via DuckDB's built-in COPY ... FORMAT PARQUET. The DuckDB `postgres_scanner` extension lets us COPY straight from local PG → Parquet without buffering rows in Node memory, and the reverse direction is the same idea.

**Tech Stack:** TypeScript, Fastify, pg, `duckdb` (Node native binding), DuckDB extensions `postgres_scanner` and `parquet` (bundled).

---

## File Structure

**Create:**
- `desktop/migrations/0007_session_blobs.sql` — local schema additions
- `desktop/migrations/cloud/0002_drop_sd_readings_add_blobs.sql` — Supabase schema migration
- `desktop/main/src/parquet/duckdb.ts` — thin wrapper over `duckdb` (open/close + helper for parameterised COPY)
- `desktop/main/src/parquet/writer.ts` — writes one Parquet file per `(session_id, source)` from local PG
- `desktop/main/src/parquet/reader.ts` — imports a Parquet file into local PG's `sd_readings`
- `desktop/main/src/parquet/manifest.ts` — manifest.json schema, build, hash
- `desktop/main/src/parquet/writer.test.ts`
- `desktop/main/src/parquet/reader.test.ts`
- `desktop/main/src/parquet/manifest.test.ts`
- `desktop/main/src/db/blobs.ts` — typed accessor for `session_blobs` table
- `desktop/main/src/db/blobs.test.ts`

**Modify:**
- `desktop/main/src/db/sessions.ts` — extend `Session` type with new columns
- `desktop/package.json` — add `duckdb` dependency
- `frontend/database/info.md` — update schema docs

---

### Task 1: Add local migration for session_blobs and sessions columns

**Files:**
- Create: `desktop/migrations/0007_session_blobs.sql`

- [ ] **Step 1: Write the migration**

Write `desktop/migrations/0007_session_blobs.sql`:

```sql
-- Local-side per-source-group blob tracking. Mirrors the cloud session_blobs
-- table so the desktop knows what it has uploaded (and where), and so the
-- pull flow can stamp the same per-file hashes it verified on download.
CREATE TABLE session_blobs (
  session_id    UUID    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL,
  object_key    TEXT    NOT NULL,
  bytes         BIGINT  NOT NULL,
  row_count     BIGINT  NOT NULL,
  content_hash  TEXT    NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, source)
);

CREATE INDEX session_blobs_content_hash_idx ON session_blobs (content_hash);

ALTER TABLE sessions
  ADD COLUMN content_hash        TEXT,
  ADD COLUMN manifest_key        TEXT,
  ADD COLUMN total_bytes         BIGINT,
  ADD COLUMN uploaded_by_machine TEXT,
  ADD COLUMN uploaded_at         TIMESTAMPTZ,
  ADD COLUMN local_deleted_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX sessions_content_hash_idx ON sessions (content_hash)
  WHERE content_hash IS NOT NULL;
```

- [ ] **Step 2: Run migrate against a scratch DB to verify it applies**

Run:
```bash
cd desktop && npx tsx -e "
import { runMigrations } from './main/src/db/migrate.ts';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.PG_TEST_URL });
await runMigrations(pool);
console.log('ok');
await pool.end();
"
```

Expected output: `ok` and `sessions` should now have the new columns. Verify with:
```bash
psql "$PG_TEST_URL" -c "\d sessions" | grep content_hash
```
Expected: shows `content_hash | text`.

- [ ] **Step 3: Commit**

```bash
git add desktop/migrations/0007_session_blobs.sql
git commit -m "db: add session_blobs and content_hash columns to local schema"
```

---

### Task 2: Add cloud migration to drop sd_readings and add blobs

**Files:**
- Create: `desktop/migrations/cloud/0002_drop_sd_readings_add_blobs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Cloud schema transition: row-oriented session storage moves out of Postgres
-- and into object storage as Parquet. This migration drops the row tables and
-- their dependent RPCs, and replaces them with a thin per-session blob catalog.

-- Drop the legacy table mentioned in frontend/database/info.md — unused for
-- a while but never removed.
DROP TABLE IF EXISTS nfr26_signals CASCADE;

-- Drop the per-sample row store and all its monthly partitions. Cascades the
-- RPCs that depend on it (get_signal_downsampled, get_session_signals,
-- get_signal_window, get_session_overview, get_session_signal_ids).
DROP TABLE IF EXISTS sd_readings CASCADE;

-- Per-source-group blob catalog. One row per Parquet file uploaded to DO
-- Spaces. session_content_hash on sessions enforces cross-machine dedup.
CREATE TABLE session_blobs (
  session_id    UUID    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL,
  object_key    TEXT    NOT NULL,
  bytes         BIGINT  NOT NULL,
  row_count     BIGINT  NOT NULL,
  content_hash  TEXT    NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, source)
);

CREATE INDEX session_blobs_content_hash_idx ON session_blobs (content_hash);

ALTER TABLE sessions
  ADD COLUMN content_hash        TEXT,
  ADD COLUMN manifest_key        TEXT,
  ADD COLUMN total_bytes         BIGINT,
  ADD COLUMN uploaded_by_machine TEXT,
  ADD COLUMN uploaded_at         TIMESTAMPTZ;

CREATE UNIQUE INDEX sessions_content_hash_idx ON sessions (content_hash)
  WHERE content_hash IS NOT NULL;
```

- [ ] **Step 2: Apply via Supabase MCP and verify**

Apply through the Supabase MCP (`mcp__supabase__apply_migration`) against project `wbtlgbmddaxeqhdntnxa`, name `0002_drop_sd_readings_add_blobs`.

Then run:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name IN ('content_hash','manifest_key','total_bytes','uploaded_by_machine','uploaded_at');
SELECT to_regclass('public.sd_readings'), to_regclass('public.session_blobs');
```

Expected: five rows returned for the first query, `(null, session_blobs)` for the second.

- [ ] **Step 3: Commit**

```bash
git add desktop/migrations/cloud/0002_drop_sd_readings_add_blobs.sql
git commit -m "db: drop cloud sd_readings, add session_blobs catalog"
```

---

### Task 3: Add duckdb dependency

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: Install duckdb**

Run:
```bash
cd desktop && npm install duckdb @types/duckdb
```

Verify `desktop/package.json` now lists `"duckdb": "^1.x"` and `"@types/duckdb": "^1.x"` under dependencies.

- [ ] **Step 2: Smoke test the install**

Run:
```bash
cd desktop && npx tsx -e "
import duckdb from 'duckdb';
const db = new duckdb.Database(':memory:');
db.all(\"SELECT 'hello' AS msg\", (e, rows) => {
  if (e) throw e;
  console.log(rows[0].msg);
  db.close();
});
"
```

Expected output: `hello`.

- [ ] **Step 3: Commit**

```bash
git add desktop/package.json desktop/package-lock.json
git commit -m "deps: add duckdb for parquet read/write"
```

---

### Task 4: DuckDB wrapper helper

**Files:**
- Create: `desktop/main/src/parquet/duckdb.ts`

- [ ] **Step 1: Write the helper**

```ts
import duckdb from 'duckdb';

/** A short-lived DuckDB instance for a single Parquet read or write. */
export class DuckDB {
  private db: duckdb.Database;
  private conn: duckdb.Connection;

  constructor() {
    this.db = new duckdb.Database(':memory:');
    this.conn = this.db.connect();
  }

  /** Run a parameterised statement and resolve when it completes. */
  run(sql: string, ...params: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.run(sql, ...params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Run a query and return all rows. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err: Error | null, rows: T[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.conn.close(() => this.db.close(() => resolve()));
    });
  }
}

/** Attaches local Postgres as a DuckDB schema named `pg`. */
export async function attachPostgres(d: DuckDB, connStr: string): Promise<void> {
  await d.run(`INSTALL postgres`);
  await d.run(`LOAD postgres`);
  await d.run(`ATTACH '${connStr.replace(/'/g, "''")}' AS pg (TYPE POSTGRES, READ_ONLY)`);
}
```

- [ ] **Step 2: Smoke test**

Run:
```bash
cd desktop && npx tsx -e "
import { DuckDB } from './main/src/parquet/duckdb.ts';
const d = new DuckDB();
const rows = await d.all('SELECT 42 AS n');
console.log(rows[0].n);
await d.close();
"
```

Expected output: `42`.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/src/parquet/duckdb.ts
git commit -m "parquet: add duckdb wrapper helper"
```

---

### Task 5: Manifest module — write + hash test

**Files:**
- Create: `desktop/main/src/parquet/manifest.ts`
- Create: `desktop/main/src/parquet/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildManifest, sessionContentHash } from './manifest.ts';

describe('manifest', () => {
  it('builds a manifest with files sorted by source', () => {
    const m = buildManifest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      createdAt: '2026-05-24T00:00:00.000Z',
      files: [
        { source: 'PDM', objectKey: 'sessions/x/PDM.parquet', bytes: 10, rowCount: 1, sha256: 'b'.repeat(64) },
        { source: 'BMS', objectKey: 'sessions/x/BMS.parquet', bytes: 20, rowCount: 2, sha256: 'a'.repeat(64) },
      ],
    });
    expect(m.files.map((f) => f.source)).toEqual(['BMS', 'PDM']);
    expect(m.manifest_version).toBe(1);
    expect(m.session_content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('session_content_hash is order-independent over inputs', () => {
    const h1 = sessionContentHash([
      { source: 'A', sha256: '1'.repeat(64) },
      { source: 'B', sha256: '2'.repeat(64) },
    ]);
    const h2 = sessionContentHash([
      { source: 'B', sha256: '2'.repeat(64) },
      { source: 'A', sha256: '1'.repeat(64) },
    ]);
    expect(h1).toBe(h2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && npx vitest run main/src/parquet/manifest.test.ts`
Expected: FAIL — cannot find `./manifest.ts`.

- [ ] **Step 3: Implement manifest.ts**

```ts
import { createHash } from 'node:crypto';

export interface ManifestFile {
  source: string;
  objectKey: string;
  bytes: number;
  rowCount: number;
  sha256: string;
}

export interface Manifest {
  session_id: string;
  manifest_version: 1;
  created_at: string;
  files: Array<{
    source: string;
    object_key: string;
    bytes: number;
    row_count: number;
    sha256: string;
  }>;
  session_content_hash: string;
}

export function sessionContentHash(
  files: Array<{ source: string; sha256: string }>,
): string {
  const sorted = [...files].sort((a, b) => a.source.localeCompare(b.source));
  const h = createHash('sha256');
  for (const f of sorted) {
    h.update(f.source);
    h.update('\0');
    h.update(f.sha256);
    h.update('\n');
  }
  return h.digest('hex');
}

export function buildManifest(input: {
  sessionId: string;
  createdAt: string;
  files: ManifestFile[];
}): Manifest {
  const sortedFiles = [...input.files].sort((a, b) =>
    a.source.localeCompare(b.source),
  );
  return {
    session_id: input.sessionId,
    manifest_version: 1,
    created_at: input.createdAt,
    files: sortedFiles.map((f) => ({
      source: f.source,
      object_key: f.objectKey,
      bytes: f.bytes,
      row_count: f.rowCount,
      sha256: f.sha256,
    })),
    session_content_hash: sessionContentHash(sortedFiles),
  };
}

export function parseManifest(raw: string): Manifest {
  const m = JSON.parse(raw) as Manifest;
  if (m.manifest_version !== 1) {
    throw new Error(`unsupported manifest_version: ${m.manifest_version}`);
  }
  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && npx vitest run main/src/parquet/manifest.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/parquet/manifest.ts desktop/main/src/parquet/manifest.test.ts
git commit -m "parquet: add manifest builder with stable content hash"
```

---

### Task 6: Parquet writer (PG → Parquet via DuckDB)

**Files:**
- Create: `desktop/main/src/parquet/writer.ts`
- Create: `desktop/main/src/parquet/writer.test.ts`

- [ ] **Step 1: Write the failing test**

This test uses a real local Postgres (set via `PG_TEST_URL`). It seeds a tiny session with two source groups and asserts that the writer produces one Parquet per source with the right row counts.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionParquet } from './writer.ts';
import { DuckDB } from './duckdb.ts';

const PG = process.env.PG_TEST_URL!;
const pool = new Pool({ connectionString: PG });
const SESSION = '11111111-1111-1111-1111-111111111111';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (1001, 'PDM', 'Volt'), (1002, 'BMS_SOE', 'Temp')
    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live')
    ON CONFLICT (id) DO NOTHING`, [SESSION]);
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 1001, 12.3),
    ('2026-05-24T00:00:02Z', $1, 1001, 12.4),
    ('2026-05-24T00:00:01Z', $1, 1002, 25.0)`, [SESSION]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SESSION]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SESSION]);
  await pool.end();
});

describe('writeSessionParquet', () => {
  it('produces one parquet per source with correct rowCounts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pq-'));
    try {
      const files = await writeSessionParquet({
        sessionId: SESSION,
        outDir: dir,
        pgConnStr: PG,
      });
      expect(files.map((f) => f.source).sort()).toEqual(['BMS_SOE', 'PDM']);
      const pdm = files.find((f) => f.source === 'PDM')!;
      expect(pdm.rowCount).toBe(2);
      const bms = files.find((f) => f.source === 'BMS_SOE')!;
      expect(bms.rowCount).toBe(1);
      const st = await stat(pdm.localPath);
      expect(st.size).toBeGreaterThan(0);

      // Round-trip via DuckDB to confirm the bytes are valid Parquet.
      const d = new DuckDB();
      const rows = await d.all<{ n: bigint }>(
        `SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${pdm.localPath.replace(/'/g, "''")}')`,
      );
      expect(Number(rows[0].n)).toBe(2);
      await d.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && PG_TEST_URL=postgresql://... npx vitest run main/src/parquet/writer.test.ts`
Expected: FAIL — `writeSessionParquet` not exported.

- [ ] **Step 3: Implement writer**

```ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DuckDB, attachPostgres } from './duckdb.ts';

export interface WrittenFile {
  source: string;
  localPath: string;
  bytes: number;
  rowCount: number;
  sha256: string;
}

export async function writeSessionParquet(opts: {
  sessionId: string;
  outDir: string;
  pgConnStr: string;
}): Promise<WrittenFile[]> {
  const d = new DuckDB();
  try {
    await attachPostgres(d, opts.pgConnStr);

    const sources = await d.all<{ source: string }>(
      `SELECT DISTINCT sd.source
       FROM pg.sd_readings r
       JOIN pg.signal_definitions sd ON sd.id = r.signal_id
       WHERE r.session_id = $sid
       ORDER BY sd.source`,
      { sid: opts.sessionId },
    );

    const out: WrittenFile[] = [];
    for (const { source } of sources) {
      const safe = source.replace(/[^A-Za-z0-9_.-]/g, '_');
      const path = join(opts.outDir, `${safe}.parquet`);
      const escPath = path.replace(/'/g, "''");
      const escSource = source.replace(/'/g, "''");

      await d.run(
        `COPY (
           SELECT r.ts AS timestamp, r.signal_id::SMALLINT AS signal_id, r.value
           FROM pg.sd_readings r
           JOIN pg.signal_definitions sd ON sd.id = r.signal_id
           WHERE r.session_id = $sid AND sd.source = '${escSource}'
           ORDER BY r.signal_id, r.ts
         ) TO '${escPath}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 1000000)`,
        { sid: opts.sessionId },
      );

      const rc = await d.all<{ n: bigint }>(
        `SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${escPath}')`,
      );
      const st = await stat(path);
      out.push({
        source,
        localPath: path,
        bytes: st.size,
        rowCount: Number(rc[0].n),
        sha256: await sha256File(path),
      });
    }
    return out;
  } finally {
    await d.close();
  }
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return h.digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && PG_TEST_URL=... npx vitest run main/src/parquet/writer.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/parquet/writer.ts desktop/main/src/parquet/writer.test.ts
git commit -m "parquet: writer streams local PG rows to per-source parquet files"
```

---

### Task 7: Parquet reader (Parquet → PG)

**Files:**
- Create: `desktop/main/src/parquet/reader.ts`
- Create: `desktop/main/src/parquet/reader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSessionParquet } from './writer.ts';
import { importParquetIntoSession } from './reader.ts';

const PG = process.env.PG_TEST_URL!;
const pool = new Pool({ connectionString: PG });
const SRC = '22222222-2222-2222-2222-222222222222';
const DST = '33333333-3333-3333-3333-333333333333';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (2001, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  for (const s of [SRC, DST]) {
    await pool.query(
      `INSERT INTO sessions (id, date, started_at, source) VALUES ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live')
       ON CONFLICT (id) DO NOTHING`, [s]);
  }
  await pool.query(
    `INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
       ('2026-05-24T00:00:01Z', $1, 2001, 1.0),
       ('2026-05-24T00:00:02Z', $1, 2001, 2.0)`, [SRC]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = ANY($1)', [[SRC, DST]]);
  await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[SRC, DST]]);
  await pool.end();
});

describe('importParquetIntoSession', () => {
  it('round-trips rows from SRC into DST', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pq-r-'));
    try {
      const files = await writeSessionParquet({ sessionId: SRC, outDir: dir, pgConnStr: PG });
      for (const f of files) {
        await importParquetIntoSession({ sessionId: DST, parquetPath: f.localPath, pgConnStr: PG });
      }
      const { rows } = await pool.query<{ n: string }>(
        'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [DST]);
      expect(Number(rows[0].n)).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && PG_TEST_URL=... npx vitest run main/src/parquet/reader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement reader**

```ts
import { DuckDB, attachPostgres } from './duckdb.ts';

export async function importParquetIntoSession(opts: {
  sessionId: string;
  parquetPath: string;
  pgConnStr: string;
}): Promise<{ rowCount: number }> {
  const d = new DuckDB();
  try {
    // Switch Postgres attach to read-write for this op.
    await d.run(`INSTALL postgres`);
    await d.run(`LOAD postgres`);
    await d.run(
      `ATTACH '${opts.pgConnStr.replace(/'/g, "''")}' AS pg (TYPE POSTGRES)`,
    );
    const esc = opts.parquetPath.replace(/'/g, "''");
    const rc = await d.all<{ n: bigint }>(
      `SELECT COUNT(*)::BIGINT AS n FROM read_parquet('${esc}')`,
    );
    await d.run(
      `INSERT INTO pg.sd_readings (ts, session_id, signal_id, value)
       SELECT timestamp, $sid::UUID, signal_id, value FROM read_parquet('${esc}')`,
      { sid: opts.sessionId },
    );
    return { rowCount: Number(rc[0].n) };
  } finally {
    await d.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && PG_TEST_URL=... npx vitest run main/src/parquet/reader.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/parquet/reader.ts desktop/main/src/parquet/reader.test.ts
git commit -m "parquet: reader imports parquet rows into local sd_readings"
```

---

### Task 8: session_blobs DB accessor

**Files:**
- Create: `desktop/main/src/db/blobs.ts`
- Create: `desktop/main/src/db/blobs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { upsertBlob, listBlobs, deleteBlobsForSession } from './blobs.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const S = '44444444-4444-4444-4444-444444444444';

beforeAll(async () => {
  await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
    ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT (id) DO NOTHING`, [S]);
});
afterAll(async () => {
  await pool.query('DELETE FROM sessions WHERE id = $1', [S]);
  await pool.end();
});

describe('blobs db accessor', () => {
  it('upserts and lists', async () => {
    await upsertBlob(pool, {
      sessionId: S, source: 'PDM', objectKey: 'k/PDM.parquet',
      bytes: 10, rowCount: 5, contentHash: 'a'.repeat(64),
    });
    await upsertBlob(pool, {
      sessionId: S, source: 'PDM', objectKey: 'k/PDM.parquet',
      bytes: 11, rowCount: 6, contentHash: 'b'.repeat(64),
    });
    const list = await listBlobs(pool, S);
    expect(list).toHaveLength(1);
    expect(list[0].bytes).toBe(11);
    await deleteBlobsForSession(pool, S);
    expect(await listBlobs(pool, S)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd desktop && PG_TEST_URL=... npx vitest run main/src/db/blobs.test.ts`
Expected: FAIL — `./blobs.ts` not found.

- [ ] **Step 3: Implement blobs.ts**

```ts
import type pg from 'pg';

export interface BlobRow {
  session_id: string;
  source: string;
  object_key: string;
  bytes: number;
  row_count: number;
  content_hash: string;
  uploaded_at: string;
}

export async function upsertBlob(pool: pg.Pool, b: {
  sessionId: string;
  source: string;
  objectKey: string;
  bytes: number;
  rowCount: number;
  contentHash: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO session_blobs (session_id, source, object_key, bytes, row_count, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, source) DO UPDATE SET
       object_key   = EXCLUDED.object_key,
       bytes        = EXCLUDED.bytes,
       row_count    = EXCLUDED.row_count,
       content_hash = EXCLUDED.content_hash,
       uploaded_at  = now()`,
    [b.sessionId, b.source, b.objectKey, b.bytes, b.rowCount, b.contentHash],
  );
}

export async function listBlobs(pool: pg.Pool, sessionId: string): Promise<BlobRow[]> {
  const { rows } = await pool.query<BlobRow>(
    `SELECT session_id, source, object_key, bytes, row_count, content_hash,
            uploaded_at::text
     FROM session_blobs WHERE session_id = $1 ORDER BY source`,
    [sessionId],
  );
  return rows;
}

export async function deleteBlobsForSession(pool: pg.Pool, sessionId: string): Promise<void> {
  await pool.query('DELETE FROM session_blobs WHERE session_id = $1', [sessionId]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd desktop && PG_TEST_URL=... npx vitest run main/src/db/blobs.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/src/db/blobs.ts desktop/main/src/db/blobs.test.ts
git commit -m "db: typed accessor for session_blobs"
```

---

### Task 9: Extend Session type

**Files:**
- Modify: `desktop/main/src/db/sessions.ts`

- [ ] **Step 1: Update Session interface and SELECTs**

Edit `desktop/main/src/db/sessions.ts`: add the new fields to the `Session` interface and to every SELECT list.

Add to the `Session` interface (just below existing fields):
```ts
  content_hash: string | null;
  manifest_key: string | null;
  total_bytes: string | null;          // BIGINT → string via pg default
  uploaded_by_machine: string | null;
  uploaded_at: string | null;
  local_deleted_at: string | null;
```

Replace each SELECT column list in `listSessions` and `getSession` to include those columns. Example for `listSessions`:
```ts
const { rows } = await pool.query<Session>(
  `SELECT id, date::text, started_at, ended_at, track, driver, car, notes,
          source, source_file, synced_at,
          content_hash, manifest_key, total_bytes::text, uploaded_by_machine,
          uploaded_at, local_deleted_at
   FROM sessions
   ORDER BY started_at DESC`,
);
```

- [ ] **Step 2: Typecheck**

Run: `cd desktop && npx tsc --noEmit -p main/tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/src/db/sessions.ts
git commit -m "db: extend Session type with content_hash/uploaded_* columns"
```

---

### Task 10: Update schema docs

**Files:**
- Modify: `frontend/database/info.md`

- [ ] **Step 1: Rewrite the schema description**

Replace the file contents with an updated description: drop the `sd_readings` table section, add `session_blobs` with the columns from Task 2, list the new columns on `sessions`, and note that `nfr26_signals` has been removed.

- [ ] **Step 2: Commit**

```bash
git add frontend/database/info.md
git commit -m "docs: update schema notes for parquet/blob catalog"
```

---

## Self-Review Notes

- Spec §6 (Catalog schema) → Tasks 1, 2 ✓
- Spec §5.1 (Parquet layout) → Task 6 (writer uses ZSTD + ordered by signal_id, ts) ✓
- Spec §5.2 (Manifest) → Task 5 ✓
- Spec §4 (Architecture, local schema unchanged for sd_readings) → preserved ✓
- Spec §12 (Migration plan) → Tasks 1, 2, 10 ✓
- No TBDs, no "implement later," every code step has real code.
