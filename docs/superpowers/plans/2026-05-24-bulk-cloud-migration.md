# Bulk Cloud Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every historical session from local Postgres (and the NDJSON backup, where local is missing rows) into DO Spaces (Parquet) + Supabase (catalog) via a one-shot diagnostic script, an optional restore script, and a one-click "Upload all" button in the desktop UI.

**Architecture:** Three discrete entry points. (1) `compare-backup-vs-local.ts` is read-only and prints a diff between the NDJSON dump in `backups/supabase-pre-parquet/` and the active local Postgres. (2) `restore-from-backup.ts` ingests backup-only sessions into local Postgres. (3) A new `<UploadAllButton>` on the Storage → Local tab loops the existing `POST /api/cloud/upload/:id` over every unsynced session, gated by a new `GET /api/cloud/unsynced-summary` endpoint that drives the confirmation modal.

**Tech Stack:** TypeScript, Node 22, `pg`, `zlib` (gunzip), `readline`, Fastify, React 19.

---

## File Structure

**Create:**
- `desktop/main/scripts/compare-backup-vs-local.ts` — diagnostic, no DB writes
- `desktop/main/scripts/compare-backup-vs-local.test.ts` — unit test using synthetic NDJSON + a scratch PG
- `desktop/main/scripts/restore-from-backup.ts` — repopulate local PG from NDJSON for specified UUIDs
- `desktop/main/scripts/restore-from-backup.test.ts`
- `desktop/main/scripts/ndjson.ts` — shared helper: streaming gunzip + line iterator
- `desktop/main/scripts/ndjson.test.ts`
- `desktop/main/src/server/routes/unsynced-summary.ts` — `GET /api/cloud/unsynced-summary`
- `desktop/main/src/server/routes/unsynced-summary.test.ts`
- `app/src/components/UploadAllButton.tsx`
- `app/src/components/UploadAllButton.test.tsx`

**Modify:**
- `desktop/main/src/server/app.ts` — register the new route
- `app/src/api/client.ts` — add `getUnsyncedSummary` helper
- `app/src/components/StorageLocalTab.tsx` — embed `<UploadAllButton />`
- `README.md` — add one-liner about "Upload all" as the migration trigger

---

### Task 1: NDJSON helper module

**Files:**
- Create: `desktop/main/scripts/ndjson.ts`
- Create: `desktop/main/scripts/ndjson.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { streamNdjsonGz } from './ndjson.ts';

describe('streamNdjsonGz', () => {
  it('yields one parsed object per line, ignoring blanks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ndjson-'));
    const path = join(dir, 'sample.ndjson.gz');
    const raw = '{"a":1}\n\n{"a":2}\n{"a":3}\n';
    await writeFile(path, gzipSync(Buffer.from(raw)));
    const got: Array<Record<string, number>> = [];
    for await (const row of streamNdjsonGz<{ a: number }>(path)) got.push(row);
    expect(got).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('returns nothing on a missing file', async () => {
    const got: unknown[] = [];
    for await (const row of streamNdjsonGz('/tmp/does-not-exist.ndjson.gz')) got.push(row);
    expect(got).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd desktop && npx vitest run main/scripts/ndjson.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import { createReadStream, existsSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

export async function* streamNdjsonGz<T>(path: string): AsyncIterable<T> {
  if (!existsSync(path)) return;
  const stream = createReadStream(path).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    yield JSON.parse(trimmed) as T;
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd desktop && npx vitest run main/scripts/ndjson.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/scripts/ndjson.ts desktop/main/scripts/ndjson.test.ts
git commit -m "scripts: streaming NDJSON.gz reader helper"
```

---

### Task 2: Compare backup vs local — core logic

**Files:**
- Create: `desktop/main/scripts/compare-backup-vs-local.ts`
- Create: `desktop/main/scripts/compare-backup-vs-local.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { computeDiff } from './compare-backup-vs-local.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const LOCAL_ONLY  = '11111111-0000-0000-0000-000000000001';
const BOTH        = '22222222-0000-0000-0000-000000000002';
const BACKUP_ONLY = '33333333-0000-0000-0000-000000000003';

beforeAll(async () => {
  for (const id of [LOCAL_ONLY, BOTH]) {
    await pool.query(
      `INSERT INTO sessions (id, date, started_at, source) VALUES
       ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'sd_import')
       ON CONFLICT (id) DO NOTHING`, [id]);
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[LOCAL_ONLY, BOTH]]);
  await pool.end();
});

describe('computeDiff', () => {
  it('classifies UUIDs into local-only / both / backup-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cmp-'));
    const sessionsPath = join(dir, 'sessions.ndjson.gz');
    const rows = [
      { id: BOTH },
      { id: BACKUP_ONLY },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(sessionsPath, gzipSync(Buffer.from(rows)));

    const diff = await computeDiff({ pool, sessionsNdjsonPath: sessionsPath });
    expect(new Set(diff.localOnly)).toEqual(new Set([LOCAL_ONLY]));
    expect(new Set(diff.both)).toEqual(new Set([BOTH]));
    expect(new Set(diff.backupOnly)).toEqual(new Set([BACKUP_ONLY]));
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd desktop && PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/scripts/compare-backup-vs-local.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import type pg from 'pg';
import { streamNdjsonGz } from './ndjson.ts';

export interface DiffResult {
  localOnly: string[];
  backupOnly: string[];
  both: string[];
}

interface SessionRow { id: string }

export async function computeDiff(opts: {
  pool: pg.Pool;
  sessionsNdjsonPath: string;
}): Promise<DiffResult> {
  const { rows } = await opts.pool.query<{ id: string }>(
    'SELECT id FROM sessions',
  );
  const local = new Set(rows.map((r) => r.id));
  const backup = new Set<string>();
  for await (const row of streamNdjsonGz<SessionRow>(opts.sessionsNdjsonPath)) {
    if (row.id) backup.add(row.id);
  }
  const localOnly: string[] = [];
  const backupOnly: string[] = [];
  const both: string[] = [];
  for (const id of local) (backup.has(id) ? both : localOnly).push(id);
  for (const id of backup) if (!local.has(id)) backupOnly.push(id);
  localOnly.sort();
  backupOnly.sort();
  both.sort();
  return { localOnly, backupOnly, both };
}
```

- [ ] **Step 4: Run, expect pass**

Run with a scratch Postgres:
```bash
docker run --rm -d --name cmp-pg -p 5433:5432 -e POSTGRES_PASSWORD=test \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=test postgres:17
sleep 4
# apply migrations
cd desktop && npx tsx -e "
import { runMigrations } from './main/src/db/migrate.ts';
import pg from 'pg';
(async () => {
  const c = new pg.Client({ connectionString: 'postgresql://postgres@localhost:5433/test' });
  await c.connect();
  await runMigrations(c, 'migrations');
  await c.end();
})();
"
PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/scripts/compare-backup-vs-local.test.ts
docker rm -f cmp-pg
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/scripts/compare-backup-vs-local.ts \
        desktop/main/scripts/compare-backup-vs-local.test.ts
git commit -m "scripts: computeDiff classifies session UUIDs into local-only/both/backup-only"
```

---

### Task 3: Compare script CLI wrapper

**Files:**
- Modify: `desktop/main/scripts/compare-backup-vs-local.ts`

- [ ] **Step 1: Add the CLI shim at the bottom of the file**

Append to `desktop/main/scripts/compare-backup-vs-local.ts`:

```ts
async function main(): Promise<void> {
  const { Pool } = await import('pg');
  const { resolve } = await import('node:path');

  const connStr = process.env.NFR_DB_URL ?? process.argv[2];
  if (!connStr) {
    console.error('usage: tsx compare-backup-vs-local.ts <connection-string>');
    console.error('   or: NFR_DB_URL=<...> tsx compare-backup-vs-local.ts');
    process.exit(2);
  }
  const sessionsNdjsonPath = resolve('backups/supabase-pre-parquet/sessions.ndjson.gz');

  const pool = new Pool({ connectionString: connStr });
  try {
    const diff = await computeDiff({ pool, sessionsNdjsonPath });
    const fmt = (ids: string[]) =>
      ids.length === 0 ? '  (none)' : ids.map((id) => `  ${id}`).join('\n');
    console.log(`Local only (will upload):           ${diff.localOnly.length}`);
    console.log(fmt(diff.localOnly));
    console.log(`Both local and backup (local wins): ${diff.both.length}`);
    console.log(fmt(diff.both));
    console.log(`Backup only (run restore!):         ${diff.backupOnly.length}`);
    console.log(fmt(diff.backupOnly));
  } finally {
    await pool.end();
  }
}

// Run main() only when invoked as a script (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: Smoke-test against your live USB DB**

Find the active data dir, point a quick connection at it via the embedded Postgres:
```bash
NFR_DB_URL="postgresql://nfr@localhost:54329/nfr" \
  npx tsx desktop/main/scripts/compare-backup-vs-local.ts
```
(Adjust port/db to your embedded PG.) Expected: the three buckets print with counts.

- [ ] **Step 3: Commit**

```bash
git add desktop/main/scripts/compare-backup-vs-local.ts
git commit -m "scripts: CLI wrapper for compare-backup-vs-local"
```

---

### Task 4: Restore-from-backup core

**Files:**
- Create: `desktop/main/scripts/restore-from-backup.ts`
- Create: `desktop/main/scripts/restore-from-backup.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { restoreSessions } from './restore-from-backup.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const SID = '44444444-0000-0000-0000-000000000004';

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
  await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
  await pool.end();
});

describe('restoreSessions', () => {
  it('inserts session + readings, translating cloud signal_id → local id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rst-'));
    // signal_definitions backup row uses cloud id=999
    await writeFile(join(dir, 'signal_definitions.ndjson.gz'),
      gzipSync(Buffer.from(JSON.stringify(
        { id: 999, source: 'PDM', signal_name: 'BusV', unit: 'V' }
      ) + '\n')));
    // sessions backup row
    await writeFile(join(dir, 'sessions.ndjson.gz'),
      gzipSync(Buffer.from(JSON.stringify({
        id: SID, date: '2026-05-24',
        started_at: '2026-05-24T00:00:00+00:00',
        ended_at:   '2026-05-24T00:01:00+00:00',
        source: 'sd_import', source_file: 'x.nfr',
        source_file_hash: null, track: null, driver: null, car: null, notes: null,
      }) + '\n')));
    // one partition file with two readings, both referencing cloud id 999
    await writeFile(join(dir, 'sd_readings_2026_05.ndjson.gz'),
      gzipSync(Buffer.from(
        [
          { ts: '2026-05-24T00:00:01+00:00', value: 12.3, signal_id: 999, session_id: SID },
          { ts: '2026-05-24T00:00:02+00:00', value: 12.4, signal_id: 999, session_id: SID },
        ].map((o) => JSON.stringify(o)).join('\n') + '\n')));

    const summary = await restoreSessions({
      pool,
      backupDir: dir,
      sessionIds: [SID],
    });
    expect(summary).toEqual({ sessions: 1, rows: 2 });

    const { rows: r } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM sd_readings WHERE session_id = $1', [SID]);
    expect(Number(r[0].n)).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run against a fresh containerised PG with migrations applied (see Task 2 step 4 for the docker incantation).
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import type pg from 'pg';
import { join } from 'node:path';
import { streamNdjsonGz } from './ndjson.ts';

interface SignalDefBackup {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  description?: string | null;
}

interface SessionBackup {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  source: string;
  source_file: string | null;
  source_file_hash: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
}

interface ReadingBackup {
  ts: string;
  value: number;
  signal_id: number;
  session_id: string;
}

export interface RestoreSummary { sessions: number; rows: number }

const PARTITION_NAMES = [
  'sd_readings_2026_03.ndjson.gz',
  'sd_readings_2026_04.ndjson.gz',
  'sd_readings_2026_05.ndjson.gz',
  'sd_readings_2026_06.ndjson.gz',
  'sd_readings_2026_07.ndjson.gz',
  'sd_readings_2026_08.ndjson.gz',
  'sd_readings_2026_09.ndjson.gz',
  'sd_readings_2026_10.ndjson.gz',
  'sd_readings_2026_11.ndjson.gz',
  'sd_readings_2026_12.ndjson.gz',
];

export async function restoreSessions(opts: {
  pool: pg.Pool;
  backupDir: string;
  sessionIds: string[];
}): Promise<RestoreSummary> {
  const wanted = new Set(opts.sessionIds);

  // 1. Build cloud-id -> local-id map for signal_definitions, upserting as needed.
  const cloudToLocal = new Map<number, number>();
  for await (const def of streamNdjsonGz<SignalDefBackup>(
    join(opts.backupDir, 'signal_definitions.ndjson.gz'),
  )) {
    const { rows } = await opts.pool.query<{ id: number }>(
      `INSERT INTO signal_definitions (source, signal_name, unit, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, signal_name) DO UPDATE
         SET unit = COALESCE(signal_definitions.unit, EXCLUDED.unit),
             description = COALESCE(signal_definitions.description, EXCLUDED.description)
       RETURNING id`,
      [def.source, def.signal_name, def.unit, def.description ?? null],
    );
    cloudToLocal.set(def.id, rows[0].id);
  }

  // 2. For each wanted session, insert + restore rows in one transaction.
  let sessionsRestored = 0;
  let rowsRestored = 0;
  const sessionsByUuid = new Map<string, SessionBackup>();
  for await (const s of streamNdjsonGz<SessionBackup>(
    join(opts.backupDir, 'sessions.ndjson.gz'),
  )) {
    if (wanted.has(s.id)) sessionsByUuid.set(s.id, s);
  }

  for (const id of opts.sessionIds) {
    const s = sessionsByUuid.get(id);
    if (!s) continue;

    const client = await opts.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO sessions (id, date, started_at, ended_at, source, source_file,
                               source_file_hash, track, driver, car, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.date, s.started_at, s.ended_at, s.source, s.source_file,
         s.source_file_hash, s.track, s.driver, s.car, s.notes],
      );

      let perSession = 0;
      for (const partName of PARTITION_NAMES) {
        for await (const r of streamNdjsonGz<ReadingBackup>(
          join(opts.backupDir, partName),
        )) {
          if (r.session_id !== id) continue;
          const localSigId = cloudToLocal.get(r.signal_id);
          if (typeof localSigId !== 'number') continue;
          await client.query(
            `INSERT INTO sd_readings (ts, session_id, signal_id, value)
             VALUES ($1, $2, $3, $4)`,
            [r.ts, id, localSigId, r.value],
          );
          perSession++;
        }
      }
      await client.query('COMMIT');
      sessionsRestored++;
      rowsRestored += perSession;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return { sessions: sessionsRestored, rows: rowsRestored };
}
```

- [ ] **Step 4: Run, expect pass**

Use the docker scratch PG. Run:
```bash
PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/scripts/restore-from-backup.test.ts
```
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add desktop/main/scripts/restore-from-backup.ts \
        desktop/main/scripts/restore-from-backup.test.ts
git commit -m "scripts: restoreSessions reads NDJSON backup into local PG"
```

---

### Task 5: Restore-from-backup CLI wrapper

**Files:**
- Modify: `desktop/main/scripts/restore-from-backup.ts`

- [ ] **Step 1: Append CLI shim**

```ts
async function main(): Promise<void> {
  const { Pool } = await import('pg');
  const { resolve } = await import('node:path');

  const connStr = process.env.NFR_DB_URL;
  if (!connStr) {
    console.error('NFR_DB_URL env var required.');
    process.exit(2);
  }
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('usage: tsx restore-from-backup.ts <session-uuid> [<session-uuid> ...]');
    process.exit(2);
  }
  const backupDir = resolve('backups/supabase-pre-parquet');

  const pool = new Pool({ connectionString: connStr });
  try {
    const summary = await restoreSessions({ pool, backupDir, sessionIds: ids });
    console.log(`Restored ${summary.sessions} session(s), ${summary.rows} reading(s).`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/main/scripts/restore-from-backup.ts
git commit -m "scripts: CLI wrapper for restore-from-backup"
```

---

### Task 6: `/api/cloud/unsynced-summary` endpoint

**Files:**
- Create: `desktop/main/src/server/routes/unsynced-summary.ts`
- Create: `desktop/main/src/server/routes/unsynced-summary.test.ts`
- Modify: `desktop/main/src/server/app.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fastify from 'fastify';
import { Pool } from 'pg';
import { registerUnsyncedSummaryRoutes } from './unsynced-summary.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const A = '55555555-0000-0000-0000-00000000000a';
const B = '55555555-0000-0000-0000-00000000000b';
const C = '55555555-0000-0000-0000-00000000000c';

beforeAll(async () => {
  await pool.query(`INSERT INTO signal_definitions (id, source, signal_name) VALUES
    (500, 'PDM', 'V') ON CONFLICT (id) DO NOTHING`);
  for (const id of [A, B, C]) {
    await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
      ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'sd_import')
      ON CONFLICT (id) DO NOTHING`, [id]);
  }
  // A: 3 readings, unsynced. B: 1 reading, synced. C: 0 readings, unsynced.
  await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
    ('2026-05-24T00:00:01Z', $1, 500, 1.0),
    ('2026-05-24T00:00:02Z', $1, 500, 2.0),
    ('2026-05-24T00:00:03Z', $1, 500, 3.0),
    ('2026-05-24T00:00:01Z', $2, 500, 9.0)`, [A, B]);
  await pool.query(`UPDATE sessions SET synced_at = now() WHERE id = $1`, [B]);
});

afterAll(async () => {
  await pool.query('DELETE FROM sd_readings WHERE session_id = ANY($1)', [[A, B, C]]);
  await pool.query('DELETE FROM sessions WHERE id = ANY($1)', [[A, B, C]]);
  await pool.end();
});

describe('GET /api/cloud/unsynced-summary', () => {
  it('returns count, approxBytes, and sessionIds for unsynced sessions only', async () => {
    const app = fastify();
    registerUnsyncedSummaryRoutes(app, pool);
    const r = await app.inject({ method: 'GET', url: '/api/cloud/unsynced-summary' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { count: number; approxBytes: number; sessionIds: string[] };
    expect(body.count).toBe(2);  // A and C; B excluded because synced_at IS NOT NULL
    expect(new Set(body.sessionIds)).toEqual(new Set([A, C]));
    expect(body.approxBytes).toBe(3 * 32);  // A has 3 rows × 32 bytes; C has 0
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd desktop && PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/src/server/routes/unsynced-summary.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

interface UnsyncedSummary {
  count: number;
  approxBytes: number;
  sessionIds: string[];
}

export function registerUnsyncedSummaryRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/api/cloud/unsynced-summary', async (): Promise<UnsyncedSummary> => {
    const { rows } = await pool.query<{ id: string; row_count: string }>(
      `SELECT s.id, COALESCE(c.row_count, 0)::text AS row_count
       FROM sessions s
       LEFT JOIN (
         SELECT session_id, COUNT(*)::bigint AS row_count
         FROM sd_readings
         GROUP BY session_id
       ) c ON c.session_id = s.id
       WHERE s.synced_at IS NULL
       ORDER BY s.started_at DESC`,
    );
    const sessionIds = rows.map((r) => r.id);
    const approxBytes = rows.reduce((sum, r) => sum + Number(r.row_count) * 32, 0);
    return { count: sessionIds.length, approxBytes, sessionIds };
  });
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd desktop && PG_TEST_URL=postgresql://postgres@localhost:5433/test npx vitest run main/src/server/routes/unsynced-summary.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Register in app.ts**

Edit `desktop/main/src/server/app.ts`:

Add to the imports block:
```ts
import { registerUnsyncedSummaryRoutes } from './routes/unsynced-summary.ts';
```

Add to the route registration section after `registerSpacesConfigRoutes(app, pool);`:
```ts
registerUnsyncedSummaryRoutes(app, pool);
```

- [ ] **Step 6: Commit**

```bash
git add desktop/main/src/server/routes/unsynced-summary.ts \
        desktop/main/src/server/routes/unsynced-summary.test.ts \
        desktop/main/src/server/app.ts
git commit -m "server: GET /api/cloud/unsynced-summary for upload-all confirm modal"
```

---

### Task 7: Frontend API helper

**Files:**
- Modify: `app/src/api/client.ts`

- [ ] **Step 1: Append helper**

```ts
export interface UnsyncedSummary {
  count: number;
  approxBytes: number;
  sessionIds: string[];
}

export async function getUnsyncedSummary(): Promise<UnsyncedSummary> {
  const r = await fetch('/api/cloud/unsynced-summary');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/api/client.ts
git commit -m "app: getUnsyncedSummary client helper"
```

---

### Task 8: `<UploadAllButton />` component

**Files:**
- Create: `app/src/components/UploadAllButton.tsx`
- Create: `app/src/components/UploadAllButton.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UploadAllButton } from './UploadAllButton.tsx';

describe('UploadAllButton', () => {
  it('confirms, then sequentially uploads every session, surfacing progress', async () => {
    const getSummary = vi.fn().mockResolvedValue({
      count: 2, approxBytes: 5_000_000, sessionIds: ['a', 'b'],
    });
    const upload = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', uploadedBytes: 100 })
      .mockResolvedValueOnce({ status: 'ok', uploadedBytes: 200 });
    const onChanged = vi.fn();

    render(<UploadAllButton
      getSummary={getSummary} uploadSession={upload} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /upload all/i }))
      .toHaveTextContent('2 sessions'));

    fireEvent.click(screen.getByRole('button', { name: /upload all/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenNthCalledWith(1, 'a');
    expect(upload).toHaveBeenNthCalledWith(2, 'b');
    expect(onChanged).toHaveBeenCalled();
  });

  it('hides itself when count is zero', async () => {
    const getSummary = vi.fn().mockResolvedValue({
      count: 0, approxBytes: 0, sessionIds: [],
    });
    render(<UploadAllButton getSummary={getSummary}
      uploadSession={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /upload all/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd app && npx vitest run src/components/UploadAllButton.test.tsx`
Expected: component missing.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';

interface Summary { count: number; approxBytes: number; sessionIds: string[] }
interface UploadResult { status: 'ok' | 'already_synced'; uploadedBytes?: number }

export interface UploadAllButtonProps {
  getSummary: () => Promise<Summary>;
  uploadSession: (id: string) => Promise<UploadResult>;
  onChanged: () => void;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function UploadAllButton(props: UploadAllButtonProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  const refresh = async () => {
    try { setSummary(await props.getSummary()); } catch { /* surface elsewhere */ }
  };
  useEffect(() => { refresh(); }, []);

  const onConfirm = async () => {
    if (!summary) return;
    setConfirming(false);
    setRunning(true);
    setCancelRequested(false);
    const ids = summary.sessionIds;
    setProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      if (cancelRequested) break;
      try { await props.uploadSession(ids[i]); }
      catch { /* error rendered by parent table row */ }
      setProgress({ done: i + 1, total: ids.length });
    }
    setRunning(false);
    setProgress(null);
    props.onChanged();
    refresh();
  };

  if (!summary || summary.count === 0) return null;

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        disabled={running}
        className="px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest disabled:opacity-50 hover:bg-[color:var(--color-bg)]"
      >
        {running && progress
          ? `UPLOADING ${progress.done} / ${progress.total}\u2026`
          : `UPLOAD ALL (${summary.count} sessions, ~${humanBytes(summary.approxBytes)})`}
      </button>
      {running && (
        <button
          onClick={() => setCancelRequested(true)}
          className="ml-2 px-3 py-1.5 border border-[color:var(--color-border)] text-[11px] tracking-widest hover:bg-[color:var(--color-bg)]"
        >CANCEL</button>
      )}
      {confirming && (
        <div role="dialog" className="border border-[color:var(--color-border)] px-3 py-2 mt-2 text-[11px] space-y-2">
          <p>
            You&rsquo;re about to upload <strong>{summary.count}</strong> session(s)
            to the cloud, approximately <strong>{humanBytes(summary.approxBytes)}</strong> total.
            The first run takes a while. Continue?
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest">CANCEL</button>
            <button onClick={onConfirm}
              className="px-3 py-1.5 border border-[color:var(--color-border)] tracking-widest">CONTINUE</button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd app && npx vitest run src/components/UploadAllButton.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/UploadAllButton.tsx \
        app/src/components/UploadAllButton.test.tsx
git commit -m "app: UploadAllButton with confirm + progress + cancel"
```

---

### Task 9: Embed `<UploadAllButton />` in StorageLocalTab

**Files:**
- Modify: `app/src/components/StorageLocalTab.tsx`
- Modify: `app/src/components/Storage.tsx`

- [ ] **Step 1: Modify StorageLocalTab to accept and render the button**

In `app/src/components/StorageLocalTab.tsx`, add to the imports:
```ts
import { UploadAllButton } from './UploadAllButton.tsx';
import { getUnsyncedSummary, uploadSession as apiUploadSession } from '../api/client.ts';
```

Inside the component's return, immediately above the `<div className="flex gap-2">` action row, insert:
```tsx
<UploadAllButton
  getSummary={getUnsyncedSummary}
  uploadSession={apiUploadSession}
  onChanged={() => onChanged?.()}
/>
```

- [ ] **Step 2: Confirm no prop wiring needed in Storage.tsx**

Storage.tsx already passes `onChanged={refreshSessions}` to StorageLocalTab. No change needed.

- [ ] **Step 3: Run all app tests to ensure no regressions**

Run: `cd app && npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/StorageLocalTab.tsx
git commit -m "app: mount UploadAllButton on Storage Local tab"
```

---

### Task 10: README pointer

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a one-liner under the "Syncing data with the cloud" section**

In the existing "Syncing data with the cloud" section of `README.md`, after the bullet that explains push, add:

```markdown
- **First time only — bulk migration.** A new install will show an
  **Upload all** button on the Local tab listing every unsynced session.
  Click it once to push all your historical drives to the cloud.
  Subsequent runs of the button only upload anything new since.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: note Upload all migration trigger in README"
```

---

## Self-Review Notes

- Spec §5 (Compare USB vs NDJSON) → Tasks 1, 2, 3 ✓
- Spec §6 (Restore backup-only sessions) → Tasks 1, 4, 5 ✓
- Spec §7 (Upload all UI button + summary endpoint) → Tasks 6, 7, 8, 9 ✓
- Spec §8 (Error handling: 409 / Spaces creds missing / file missing) — handled by the existing `uploadSession` orchestrator (already covered by the upload-flow plan) and by `streamNdjsonGz`'s `existsSync` short-circuit. UI surfaces per-row errors via the existing StorageLocalTab Retry button.
- Spec §9 (Testing) — every script + endpoint + component has a focused test.
- Spec §10 step 7 (README) → Task 10 ✓
- No TBDs, no "implement later", no "similar to Task N". Every code step shows the actual code.
- Types stay consistent: `Summary`/`UnsyncedSummary` keys are `count`, `approxBytes`, `sessionIds` everywhere.
- `restoreSessions` and `computeDiff` are the only two exported names; CLI wrappers live in the same files behind `if (import.meta.url === ...)` guards so the test imports stay clean.
