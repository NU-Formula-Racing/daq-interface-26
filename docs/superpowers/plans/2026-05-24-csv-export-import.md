# CSV Export + Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a long-form CSV export button on both the desktop app and the web app, and add a CSV import path on the desktop that ingests files exported by either app (or the web export of any session). Format is exactly `timestamp,source,signal_name,value`.

**Architecture:** The desktop already exposes `/api/sessions/:id/export.csv` — rework it to emit the spec's exact 4-column shape (drop the extra `unit` column) and add a frontend button. The web app reuses the DuckDB-wasm instance from the reads plan, runs `COPY (...) TO 'export.csv' (HEADER, DELIMITER ',')` against the Parquet files plus a small in-memory signal-definitions table, and triggers a browser download. Desktop CSV import detects long-form by header, then routes rows through the existing session-creation + `sd_readings` insert path.

**Tech Stack:** TypeScript, Fastify, React, DuckDB-wasm.

**Depends on:** Plan `2026-05-24-catalog-and-parquet-foundation.md` (no new schema, but uses the existing `signal_definitions`). The web export specifically depends on `2026-05-24-web-duckdb-wasm-reads.md` (uses `getDuckDB`).

---

## File Structure

**Create:**
- `desktop/main/src/csv/import.ts` — long-form CSV parser → local PG
- `desktop/main/src/csv/import.test.ts`
- `desktop/main/src/server/routes/import-csv.ts`
- `app/src/components/ExportCsvButton.tsx`
- `app/src/components/ExportCsvButton.test.tsx`
- `frontend/interface/src/components/ExportCsvButton.tsx`
- `frontend/interface/src/components/ExportCsvButton.test.tsx`

**Modify:**
- `desktop/main/src/server/routes/export.ts` — drop the `unit` column to match spec
- `desktop/main/src/server/routes/export.ts` test (if one exists) — update assertions
- `desktop/main/src/server/app.ts` — register CSV import route
- `app/src/pages/Sessions.tsx` (or the session-detail page) — mount the desktop ExportCsvButton
- Web app session-detail page — mount the web ExportCsvButton

---

### Task 1: Update desktop CSV export endpoint to spec shape

**Files:**
- Modify: `desktop/main/src/server/routes/export.ts`

- [ ] **Step 1: Write a test for the new shape**

If `desktop/main/src/server/routes/export.test.ts` does not exist, create it.

```ts
import { describe, it, expect } from 'vitest';
import fastify from 'fastify';
import { Pool } from 'pg';
import { registerExportRoutes } from './export.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });
const SID = '88888888-8888-8888-8888-888888888888';

describe('GET /api/sessions/:id/export.csv', () => {
  it('emits exactly timestamp,source,signal_name,value', async () => {
    await pool.query(`INSERT INTO signal_definitions (id, source, signal_name, unit) VALUES
      (8001, 'PDM', 'V', 'V') ON CONFLICT (id) DO NOTHING`);
    await pool.query(`INSERT INTO sessions (id, date, started_at, source) VALUES
      ($1, '2026-05-24', '2026-05-24T00:00:00Z', 'live') ON CONFLICT DO NOTHING`, [SID]);
    await pool.query(`INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES
      ('2026-05-24T00:00:01.000000Z', $1, 8001, 1.25)`, [SID]);

    const app = fastify();
    registerExportRoutes(app, pool);
    const r = await app.inject({ method: 'GET', url: `/api/sessions/${SID}/export.csv` });
    expect(r.statusCode).toBe(200);
    const lines = r.body.trim().split('\n');
    expect(lines[0]).toBe('timestamp,source,signal_name,value');
    expect(lines[1]).toBe('2026-05-24T00:00:01.000000Z,PDM,V,1.25');

    await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [SID]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [SID]);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail (existing endpoint emits 5-column header).**

- [ ] **Step 3: Rewrite export.ts**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** ISO-8601 UTC with microsecond precision: 2026-05-24T00:00:01.123456Z. */
function isoMicros(d: Date): string {
  // Date supports ms precision; for microseconds beyond, we pad zeros — the
  // underlying TIMESTAMPTZ in PG keeps full precision, but the JS Date round
  // trip loses it. Stream as text from PG instead.
  return d.toISOString().replace('Z', '000Z');
}

export function registerExportRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/export.csv',
    async (req, reply) => {
      const id = req.params.id;
      // Cast ts to text with the canonical precision so we preserve microseconds.
      const { rows } = await pool.query<{
        ts: string; source: string; signal_name: string; value: string;
      }>(
        `SELECT to_char(r.ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts,
                sd.source, sd.signal_name, r.value::text AS value
         FROM (
           SELECT ts, signal_id, value FROM sd_readings WHERE session_id = $1
           UNION ALL
           SELECT ts, signal_id, value FROM rt_readings WHERE session_id = $1
         ) r
         JOIN signal_definitions sd ON sd.id = r.signal_id
         ORDER BY r.ts`,
        [id],
      );

      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="session_${id}.csv"`,
      );

      const parts: string[] = ['timestamp,source,signal_name,value\n'];
      for (const r of rows) {
        parts.push(
          `${r.ts},${csvEscape(r.source)},${csvEscape(r.signal_name)},${r.value}\n`,
        );
      }
      return parts.join('');
    },
  );
}
```

- [ ] **Step 4: Run test, expect pass; commit.**

```bash
git add desktop/main/src/server/routes/export.ts desktop/main/src/server/routes/export.test.ts
git commit -m "export: emit spec-shaped long-form CSV (timestamp,source,signal_name,value)"
```

---

### Task 2: Desktop ExportCsvButton

**Files:**
- Create: `app/src/components/ExportCsvButton.tsx`
- Create: `app/src/components/ExportCsvButton.test.tsx`

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportCsvButton } from './ExportCsvButton.tsx';

describe('ExportCsvButton (desktop)', () => {
  it('navigates to the export endpoint for the given session', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(<ExportCsvButton sessionId="abc" />);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(open).toHaveBeenCalledWith('/api/sessions/abc/export.csv');
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```tsx
export function ExportCsvButton({ sessionId }: { sessionId: string }) {
  return (
    <button onClick={() => window.open(`/api/sessions/${sessionId}/export.csv`)}>
      Export CSV
    </button>
  );
}
```

- [ ] **Step 4: Run, expect pass; commit.**

```bash
git add app/src/components/ExportCsvButton.tsx app/src/components/ExportCsvButton.test.tsx
git commit -m "app: ExportCsvButton triggers desktop export endpoint"
```

---

### Task 3: Mount ExportCsvButton on the session detail view

**Files:**
- Modify: `app/src/pages/Sessions.tsx` (or wherever the session header lives)

- [ ] **Step 1: Add the button next to the existing session controls**

```tsx
import { ExportCsvButton } from '@/components/ExportCsvButton';
// ...
<ExportCsvButton sessionId={session.id} />
```

- [ ] **Step 2: Manual verification**

Open a session in the desktop app → click Export CSV → confirm the browser downloads `session_<id>.csv` with the right header and content.

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/Sessions.tsx
git commit -m "app: mount ExportCsvButton on session detail"
```

---

### Task 4: Web ExportCsvButton (DuckDB-wasm)

**Files:**
- Create: `frontend/interface/src/components/ExportCsvButton.tsx`
- Create: `frontend/interface/src/components/ExportCsvButton.test.tsx`

- [ ] **Step 1: Test (mock DuckDB)**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportCsvButton } from './ExportCsvButton.tsx';

vi.mock('@/lib/duckdb', () => ({
  getDuckDB: vi.fn().mockResolvedValue({
    connect: async () => ({
      query: vi.fn().mockResolvedValue({ toArray: () => [] }),
      close: async () => {},
    }),
    registerFileURL: vi.fn(),
    copyFileToBuffer: vi.fn().mockResolvedValue(new Uint8Array([116,115])),
  }),
  registerParquetUrl: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [
    { id: 1, source: 'PDM', signal_name: 'V' }
  ]}) }) },
}));

describe('ExportCsvButton (web)', () => {
  it('runs DuckDB COPY and triggers a download', async () => {
    const click = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: () => {},
    });
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = orig(tag);
      if (tag === 'a') el.click = click;
      return el;
    });
    render(<ExportCsvButton sessionId="s1" manifest={{
      session_id: 's1', manifest_version: 1,
      files: [{ source: 'PDM', object_key: 'sessions/s1/PDM.parquet', bytes: 1, row_count: 1, sha256: 'x' }],
    }} />);
    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(click).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import { getDuckDB, registerParquetUrl } from '@/lib/duckdb';
import { spacesUrl } from '@/lib/spacesUrl';
import { supabase } from '@/lib/supabaseClient';
import type { SessionManifest } from '@/adapters/useSessionManifest';

export function ExportCsvButton({ sessionId, manifest }: { sessionId: string; manifest: SessionManifest }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { data: defs } = await supabase.from('signal_definitions')
        .select('id, source, signal_name');
      const db = await getDuckDB();
      const conn = await db.connect();
      try {
        // Build a small in-memory table from signal_definitions.
        await conn.query(`CREATE OR REPLACE TABLE sd (id SMALLINT, source TEXT, signal_name TEXT)`);
        const rows = (defs ?? []) as Array<{ id: number; source: string; signal_name: string }>;
        for (let i = 0; i < rows.length; i += 1000) {
          const chunk = rows.slice(i, i + 1000);
          const values = chunk.map((r) =>
            `(${r.id}, '${r.source.replace(/'/g, "''")}', '${r.signal_name.replace(/'/g, "''")}')`,
          ).join(',');
          await conn.query(`INSERT INTO sd VALUES ${values}`);
        }
        // Register each Parquet by its object key as a virtual file.
        for (const f of manifest.files) {
          await registerParquetUrl(db, f.object_key, spacesUrl(f.object_key));
        }
        const union = manifest.files
          .map((f) => `SELECT "timestamp", signal_id, value FROM read_parquet('${f.object_key}')`)
          .join(' UNION ALL ');
        await conn.query(`
          COPY (
            SELECT strftime("timestamp", '%Y-%m-%dT%H:%M:%S.%fZ') AS timestamp,
                   sd.source, sd.signal_name, r.value
            FROM (${union}) r JOIN sd ON sd.id = r.signal_id
            ORDER BY r."timestamp"
          ) TO 'out.csv' (HEADER, DELIMITER ',')
        `);
        const buf = await db.copyFileToBuffer('out.csv');
        const blob = new Blob([buf], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `session_${sessionId}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        await conn.close();
      }
    } finally {
      setBusy(false);
    }
  };
  return <button onClick={run} disabled={busy}>{busy ? 'Exporting…' : 'Export CSV'}</button>;
}
```

- [ ] **Step 4: Run test, expect pass; commit.**

```bash
git add frontend/interface/src/components/ExportCsvButton.tsx \
        frontend/interface/src/components/ExportCsvButton.test.tsx
git commit -m "web: ExportCsvButton uses duckdb-wasm to export long-form CSV"
```

---

### Task 5: Mount web ExportCsvButton on session detail

**Files:**
- Modify: the web app's session detail page (find with `grep -RIl useSessionManifest frontend/interface/src/pages`)

- [ ] **Step 1: Add to the header**

```tsx
import { ExportCsvButton } from '@/components/ExportCsvButton';
// near other session controls:
{manifest && <ExportCsvButton sessionId={session.id} manifest={manifest} />}
```

- [ ] **Step 2: Manual verify**

Open the web app, navigate to a session, click Export CSV, confirm the downloaded file has the spec header and parses as long-form CSV.

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/pages/<page>.tsx
git commit -m "web: mount ExportCsvButton on session detail"
```

---

### Task 6: Desktop CSV importer module

**Files:**
- Create: `desktop/main/src/csv/import.ts`
- Create: `desktop/main/src/csv/import.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLongCsv } from './import.ts';

const pool = new Pool({ connectionString: process.env.PG_TEST_URL! });

afterAll(async () => { await pool.end(); });

describe('importLongCsv', () => {
  it('ingests a 4-column CSV into sd_readings as a new session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csv-'));
    const path = join(dir, 'sample.csv');
    await writeFile(path,
      'timestamp,source,signal_name,value\n' +
      '2026-05-24T00:00:01.000000Z,PDM,V,1.0\n' +
      '2026-05-24T00:00:02.000000Z,PDM,V,2.0\n' +
      '2026-05-24T00:00:01.500000Z,BMS,Temp,25.5\n'
    );
    const res = await importLongCsv({ pool, filePath: path, filename: 'sample.csv' });
    expect(res.rowCount).toBe(3);
    const { rows } = await pool.query<{ n: string }>(
      'SELECT COUNT(*)::TEXT AS n FROM sd_readings WHERE session_id = $1', [res.sessionId]);
    expect(Number(rows[0].n)).toBe(3);
    await pool.query('DELETE FROM sd_readings WHERE session_id = $1', [res.sessionId]);
    await pool.query('DELETE FROM sessions WHERE id = $1', [res.sessionId]);
  });

  it('rejects non-matching headers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csv-'));
    const path = join(dir, 'bad.csv');
    await writeFile(path, 'when,who,what\n1,2,3\n');
    await expect(importLongCsv({ pool, filePath: path, filename: 'bad.csv' }))
      .rejects.toThrow(/unsupported csv header/i);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import type pg from 'pg';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const EXPECTED_HEADER = 'timestamp,source,signal_name,value';

export interface CsvImportResult {
  sessionId: string;
  rowCount: number;
}

function parseCsvLine(line: string): string[] {
  // Minimal parser for our own emitted shape (we know quoting only wraps fields
  // that contain a comma, quote, or newline; we never emit embedded newlines).
  const out: string[] = [];
  let i = 0, cur = '', q = false;
  while (i < line.length) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { q = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { out.push(cur); cur = ''; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return out;
}

async function ensureSignalId(client: pg.PoolClient, cache: Map<string, number>, source: string, name: string): Promise<number> {
  const k = `${source}\0${name}`;
  const cached = cache.get(k);
  if (cached !== undefined) return cached;
  const sel = await client.query<{ id: number }>(
    `SELECT id FROM signal_definitions WHERE source = $1 AND signal_name = $2`,
    [source, name]);
  if (sel.rows.length > 0) { cache.set(k, sel.rows[0].id); return sel.rows[0].id; }
  const ins = await client.query<{ id: number }>(
    `INSERT INTO signal_definitions (source, signal_name) VALUES ($1, $2) RETURNING id`,
    [source, name]);
  cache.set(k, ins.rows[0].id);
  return ins.rows[0].id;
}

export async function importLongCsv(opts: {
  pool: pg.Pool;
  filePath: string;
  filename: string;
}): Promise<CsvImportResult> {
  // Validate header up front.
  const rl = createInterface({ input: createReadStream(opts.filePath), crlfDelay: Infinity });
  const it = rl[Symbol.asyncIterator]();
  const first = await it.next();
  if (first.done || first.value.trim() !== EXPECTED_HEADER) {
    rl.close();
    throw new Error(`unsupported CSV header (expected: ${EXPECTED_HEADER})`);
  }

  const sourceFileHash = createHash('sha256').update(await readFile(opts.filePath)).digest('hex');
  const sessionId = randomUUID();

  const client = await opts.pool.connect();
  const cache = new Map<string, number>();
  let rowCount = 0;
  try {
    await client.query('BEGIN');
    // Insert the session row up front so FK on sd_readings is satisfied.
    // started_at/date will be back-filled from the first row's timestamp.
    let firstTs: string | null = null;
    let lastTs: string | null = null;
    const buffer: Array<[string, number, string]> = [];
    for await (const line of it as AsyncIterable<string>) {
      if (line.length === 0) continue;
      const [ts, source, signal, value] = parseCsvLine(line);
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
      const id = await ensureSignalId(client, cache, source, signal);
      buffer.push([ts, id, value]);
      if (buffer.length >= 10_000) {
        await flush(client, sessionId, buffer);
        rowCount += buffer.length;
        buffer.length = 0;
      }
    }
    if (buffer.length > 0) { await flush(client, sessionId, buffer); rowCount += buffer.length; }
    if (!firstTs) { await client.query('ROLLBACK'); throw new Error('empty CSV'); }

    await client.query(
      `INSERT INTO sessions (id, date, started_at, ended_at, source, source_file, source_file_hash)
       VALUES ($1, ($2::timestamptz AT TIME ZONE 'UTC')::date, $2, $3, 'sd_import', $4, $5)`,
      [sessionId, firstTs, lastTs, opts.filename, sourceFileHash],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { sessionId, rowCount };
}

async function flush(client: pg.PoolClient, sessionId: string, rows: Array<[string, number, string]>): Promise<void> {
  // Use a single multi-row INSERT for speed; for very large files prefer COPY.
  const values: unknown[] = [];
  const tuples: string[] = [];
  rows.forEach((r, i) => {
    const base = i * 4;
    tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(r[0], sessionId, r[1], r[2]);
  });
  await client.query(
    `INSERT INTO sd_readings (ts, session_id, signal_id, value) VALUES ${tuples.join(',')}`,
    values,
  );
}
```

- [ ] **Step 4: Run, expect pass; commit.**

```bash
git add desktop/main/src/csv/import.ts desktop/main/src/csv/import.test.ts
git commit -m "csv: long-form importer with header detection"
```

---

### Task 7: Fastify route for CSV import

**Files:**
- Create: `desktop/main/src/server/routes/import-csv.ts`
- Modify: `desktop/main/src/server/app.ts`

- [ ] **Step 1: Implement**

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLongCsv } from '../../csv/import.ts';

const MAX_CSV_BYTES = 500 * 1024 * 1024;

export function registerCsvImportRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.post('/api/import/csv', { bodyLimit: MAX_CSV_BYTES }, async (req, reply) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: 'expected text/csv body' });
    }
    const filename = (req.headers['x-filename'] as string) ?? `upload-${Date.now()}.csv`;
    const dir = await mkdtemp(join(tmpdir(), 'csv-upload-'));
    const path = join(dir, 'input.csv');
    try {
      await writeFile(path, body);
      const r = await importLongCsv({ pool, filePath: path, filename });
      return { session_id: r.sessionId, row_count: r.rowCount };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
```

- [ ] **Step 2: Register in `desktop/main/src/server/app.ts`**

```ts
import { registerCsvImportRoutes } from './routes/import-csv.ts';
// alongside registerImportRoutes:
registerCsvImportRoutes(app, pool);
```

- [ ] **Step 3: Smoke test**

```bash
curl -X POST -H 'content-type: text/csv' -H 'x-filename: smoke.csv' \
  --data-binary @session_2026-04-21_1.csv \
  http://localhost:4444/api/import/csv
```
Expected: returns `{ session_id, row_count }` with a positive row_count.

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/server/routes/import-csv.ts desktop/main/src/server/app.ts
git commit -m "server: POST /api/import/csv for long-form CSV"
```

---

### Task 8: Frontend Import CSV menu entry

**Files:**
- Modify: wherever the existing `.nfr` import button lives in `app/src/` (likely a setup/import page)

- [ ] **Step 1: Add a sibling button**

```tsx
const onPickCsv = async (file: File) => {
  const buf = await file.arrayBuffer();
  const r = await fetch('/api/import/csv', {
    method: 'POST',
    headers: { 'content-type': 'text/csv', 'x-filename': file.name },
    body: buf,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
  // refresh sessions list or navigate
};
// ...
<input type="file" accept=".csv" onChange={(e) => e.target.files && onPickCsv(e.target.files[0])} />
<label>Import CSV</label>
```

- [ ] **Step 2: Manual verify**

Export a session to CSV via Task 3, delete the local session, import that same CSV back, confirm row counts match and graphs render.

- [ ] **Step 3: Commit**

```bash
git add app/src/...
git commit -m "app: Import CSV file picker"
```

---

## Self-Review Notes

- Spec §5.3 (CSV format) — Tasks 1, 2, 4, 6 all use `timestamp,source,signal_name,value` ✓
- Spec §10.1 (desktop export button) — Tasks 2, 3 ✓
- Spec §10.2 (web export via DuckDB COPY) — Task 4 ✓
- Spec §11 (CSV import desktop, header detection, route through existing session-ingest path) — Tasks 6, 7, 8 ✓
- Spec §11 "no schema fuzzing" — Task 6 rejects any header other than exact match ✓
- Round-trip equality across export → import is exercised in Task 8 manual verify ✓
- No TBDs.
