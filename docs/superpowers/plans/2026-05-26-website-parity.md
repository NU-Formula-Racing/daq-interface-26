# Website Parity with Desktop App Implementation Plan (Option B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public website's `/app` route actually serve cloud sessions by adding a Supabase Edge Function that reads Parquet from DigitalOcean Spaces, fix the broken signal-id catalog, port the desktop-style session picker, and verify widget parity.

**Architecture:** Edge function (Deno + DuckDB-WASM) does HTTP range reads against the public DO Spaces base, buckets server-side, returns the existing RpcRow JSON shape. The website calls it via `supabase.functions.invoke('signals-window', ...)` instead of `supabase.rpc(...)`. `get_session_signal_ids` SQL is rewritten to derive ids from `session_blobs ⋈ signal_definitions` (no `sd_readings` dependency).

**Tech Stack:** Supabase Edge Functions (Deno), `@duckdb/duckdb-wasm`, React 19 + Vite (website), `vitest`, `@testing-library/react`.

**Hard constraint:** Do not modify any file under `app/`, `desktop/`, `parser/`, or `packages/widgets/`. Work is on branch `website-parity` inside `.worktrees/website-parity`.

**State of play:**
- Task 1 of the prior plan already verified: Spaces public base is reachable;
  manifests + Parquet files are public; `sd_readings` does NOT exist on
  Supabase; pre-existing SQL functions are broken.

---

## File map

**Create:**
- `supabase/functions/signals-window/index.ts` — new Edge Function.
- `supabase/functions/signals-window/deno.json` — Deno config (DuckDB-WASM import).
- `supabase/functions/signals-window/test.ts` — Deno smoke test.
- `frontend/interface/src/components/SessionPicker.jsx` — calendar picker.
- `frontend/interface/src/components/SessionPicker.test.jsx` — picker tests.

**Modify:**
- `frontend/database/supabase_functions.sql` — rewrite `get_session_signal_ids`;
  add `source` to `list_sessions` return.
- `frontend/interface/src/adapters/useSupabaseFrames.ts` — swap RPC for
  Edge Function; fractional bucket; minor type changes.
- `frontend/interface/src/adapters/bucketFor.ts` — delete.
- `frontend/interface/src/adapters/bucketFor.test.ts` — delete.
- `frontend/interface/src/adapters/useSessionList.ts` — add `source` field.
- `frontend/interface/src/routes/AppRoute.jsx` — wire new picker; remove
  dead `selectedDate`/`urlDate` block.
- `frontend/interface/src/components/DateAndSessionPicker.jsx` — delete.
- `frontend/interface/src/components/DatePicker.jsx` + `DatePicker.css` —
  delete if no other importers.

**Verify (read-only):** `desktop/build/cloud-defaults.json`,
`packages/widgets/src/dock/dir-dock.tsx`.

---

## Task 1: Rewrite broken SQL functions (signal-ids + list_sessions)

**Files:**
- Modify: `frontend/database/supabase_functions.sql`

- [ ] **Step 1: Read current state of the two functions**

```bash
sed -n '115,200p' frontend/database/supabase_functions.sql
```

- [ ] **Step 2: Rewrite `get_session_signal_ids` to use `session_blobs`**

Replace the body of `get_session_signal_ids` (lines ~117 onward) with:
```sql
CREATE OR REPLACE FUNCTION get_session_signal_ids(p_session_id UUID)
RETURNS TABLE (signal_id SMALLINT)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT sd.id::SMALLINT AS signal_id
  FROM session_blobs sb
  JOIN signal_definitions sd ON sd.source = sb.source
  WHERE sb.session_id = p_session_id
  ORDER BY sd.id;
$$;
```

- [ ] **Step 3: Add `source` to `list_sessions`**

Find the `list_sessions` function (around line 162). Add `source TEXT` to the
`RETURNS TABLE (...)` column list, and `s.source` to the SELECT in matching
position. Keep the existing `DROP FUNCTION IF EXISTS list_sessions(integer);`
and update the new signature accordingly.

- [ ] **Step 4: Apply both changes as a Supabase migration**

Use Supabase MCP `apply_migration` with migration name
`fix_signal_ids_and_session_source`. Migration body = both function
definitions in one block.

- [ ] **Step 5: Verify with `execute_sql`**

```sql
SELECT COUNT(*) FROM get_session_signal_ids(
  '8ac70c7f-890b-55cd-9b00-7d98cb2dc313'::uuid
);
```
Expected: > 0.

```sql
SELECT id, source FROM list_sessions(3);
```
Expected: rows with non-null `source`.

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/website-parity
git add frontend/database/supabase_functions.sql
git commit -m "supabase: rewrite get_session_signal_ids; add source to list_sessions"
```

---

## Task 2: Scaffold the `signals-window` Edge Function

**Files:**
- Create: `supabase/functions/signals-window/index.ts`
- Create: `supabase/functions/signals-window/deno.json`

- [ ] **Step 1: Confirm `supabase` CLI directory layout**

```bash
ls supabase 2>/dev/null && ls supabase/functions 2>/dev/null
```
If `supabase/` doesn't exist yet, create the path tree:
```bash
mkdir -p supabase/functions/signals-window
```

- [ ] **Step 2: Write `deno.json`**

Create `supabase/functions/signals-window/deno.json`:
```json
{
  "imports": {
    "@duckdb/duckdb-wasm": "npm:@duckdb/duckdb-wasm@1.29.0"
  }
}
```

- [ ] **Step 3: Write the function skeleton (no DuckDB yet)**

Create `supabase/functions/signals-window/index.ts`:
```ts
// Supabase Edge Function: signals-window
// Reads per-source Parquet files from DO Spaces, buckets server-side,
// returns the historical RpcRow shape the website expects.

import { createClient } from 'jsr:@supabase/supabase-js@2';

interface Body {
  session_id: string;
  signal_ids: number[];
  start: string;
  end: string;
  bucket_secs: number;
}

interface RpcRow {
  ts: string;
  signal_id: number;
  signal_name: string;
  unit: string;
  value_min: number;
  value_max: number;
  value_avg: number;
  sample_n: number;
}

const SPACES_BASE = Deno.env.get('SPACES_PUBLIC_BASE')
  ?? 'https://nfrinterface.sfo3.digitaloceanspaces.com';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method', { status: 405 });
  let body: Body;
  try { body = await req.json() as Body; }
  catch { return new Response('bad json', { status: 400 }); }

  if (!body.session_id || !Array.isArray(body.signal_ids) || body.signal_ids.length === 0
      || !body.start || !body.end || !(body.bucket_secs > 0)) {
    return new Response('missing fields', { status: 400 });
  }

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1. Look up which `source` each requested signal_id belongs to.
  const { data: defs, error: defsErr } = await supa
    .from('signal_definitions')
    .select('id, signal_name, unit, source')
    .in('id', body.signal_ids);
  if (defsErr) return new Response(defsErr.message, { status: 500 });
  if (!defs || defs.length === 0) {
    return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });
  }

  // For now: stub — real Parquet read lands in Task 3.
  const rows: RpcRow[] = [];
  return new Response(JSON.stringify(rows), {
    headers: { 'content-type': 'application/json' },
  });
});
```

- [ ] **Step 4: Deploy via Supabase MCP**

Use `mcp__supabase__deploy_edge_function` with:
- `name`: `signals-window`
- `files`: include `index.ts` (and `deno.json` if the tool supports it).

- [ ] **Step 5: Smoke test the stub**

```bash
curl -X POST "https://wbtlgbmddaxeqhdntnxa.supabase.co/functions/v1/signals-window" \
  -H "Authorization: Bearer $(grep VITE_SUPABASE_ANON_KEY frontend/interface/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "8ac70c7f-890b-55cd-9b00-7d98cb2dc313",
    "signal_ids": [1],
    "start": "2026-05-17T22:33:10.703Z",
    "end":   "2026-05-17T22:34:51.658Z",
    "bucket_secs": 1
  }'
```
Expected: `[]` (stub returns empty). 200 status.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/signals-window/
git commit -m "supabase: scaffold signals-window edge function (stub)"
```

---

## Task 3: Implement DuckDB-WASM Parquet aggregation

**Files:**
- Modify: `supabase/functions/signals-window/index.ts`

- [ ] **Step 1: Add the DuckDB-WASM bootstrap**

Replace the `// For now: stub` section with a real DuckDB read. Add this
helper at module scope (above `Deno.serve`):
```ts
import * as duckdb from '@duckdb/duckdb-wasm';

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const worker = await duckdb.createWorker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })();
  return dbPromise;
}
```

- [ ] **Step 2: Replace the stub with the real query**

Substitute the `// For now: stub — real Parquet read lands in Task 3.` block
and trailing `return` with:
```ts
  // 2. Group requested signal_ids by source -> parquet URL.
  const bySource = new Map<string, number[]>();
  for (const d of defs) {
    const safe = String(d.source).replace(/[^A-Za-z0-9_.-]/g, '_');
    const arr = bySource.get(safe) ?? [];
    arr.push(d.id);
    bySource.set(safe, arr);
  }

  // 3. Build a UNION ALL across one read_parquet per source.
  const unionPieces: string[] = [];
  const params: Array<string | number> = [];
  for (const [safe, ids] of bySource) {
    const url = `${SPACES_BASE}/sessions/${body.session_id}/${safe}.parquet`;
    const idList = ids.map((n) => String(n)).join(',');
    unionPieces.push(
      `SELECT timestamp AS ts, signal_id, value
       FROM read_parquet('${url.replace(/'/g, "''")}')
       WHERE signal_id IN (${idList})
         AND timestamp >= TIMESTAMP '${body.start.replace(/'/g, "''")}'
         AND timestamp <  TIMESTAMP '${body.end.replace(/'/g, "''")}'`
    );
  }
  if (unionPieces.length === 0) {
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }

  const bucket = Number(body.bucket_secs);
  const sql = `
    WITH all_rows AS (
      ${unionPieces.join('\n      UNION ALL\n      ')}
    )
    SELECT
      to_timestamp(floor(epoch(ts) / ${bucket}) * ${bucket}) AS ts,
      signal_id,
      min(value) AS value_min,
      max(value) AS value_max,
      avg(value) AS value_avg,
      COUNT(*)::INT AS sample_n
    FROM all_rows
    GROUP BY 1, 2
    ORDER BY 1, 2;
  `;

  const db = await getDuckDB();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    const defById = new Map(defs.map((d) => [d.id, d]));
    const out: RpcRow[] = [];
    for (let i = 0; i < result.numRows; i++) {
      const r = result.get(i)!.toJSON() as {
        ts: Date; signal_id: number; value_min: number;
        value_max: number; value_avg: number; sample_n: number;
      };
      const def = defById.get(Number(r.signal_id));
      out.push({
        ts: r.ts.toISOString(),
        signal_id: Number(r.signal_id),
        signal_name: def?.signal_name ?? '',
        unit: def?.unit ?? '',
        value_min: r.value_min,
        value_max: r.value_max,
        value_avg: r.value_avg,
        sample_n: r.sample_n,
      });
    }
    return new Response(JSON.stringify(out), {
      headers: { 'content-type': 'application/json' },
    });
  } finally {
    await conn.close();
  }
```

- [ ] **Step 3: Deploy the updated function**

Re-run `mcp__supabase__deploy_edge_function` with the new `index.ts`.

- [ ] **Step 4: Smoke test against the real session**

Find a signal_id that exists in the BMS source:
```sql
SELECT id, signal_name, source FROM signal_definitions WHERE source = 'BMS' LIMIT 3;
```

Then:
```bash
curl -X POST "https://wbtlgbmddaxeqhdntnxa.supabase.co/functions/v1/signals-window" \
  -H "Authorization: Bearer $(grep VITE_SUPABASE_ANON_KEY frontend/interface/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "8ac70c7f-890b-55cd-9b00-7d98cb2dc313",
    "signal_ids": [<ID>],
    "start": "2026-05-17T22:33:10.703Z",
    "end":   "2026-05-17T22:34:51.658Z",
    "bucket_secs": 1
  }' | head -c 500
```
Expected: JSON array of rows with `ts`, `signal_id`, `signal_name`, `unit`,
`value_min`, `value_max`, `value_avg`, `sample_n`. Non-empty.

If it returns a DuckDB-WASM init error: the `getJsDelivrBundles` path is
unreachable from Supabase's edge runtime. Fall back to `@duckdb/node-api`
(npm package that ships native binaries) which Deno supports via its
`npm:` specifier with no WASM. Replace the bootstrap to:
```ts
import { DuckDBInstance } from 'npm:@duckdb/node-api@1.1.3';
const instance = await DuckDBInstance.create();
const conn = await instance.connect();
```
Adapt the result-reading code accordingly.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/signals-window/index.ts
git commit -m "supabase: signals-window reads Parquet via DuckDB + UNION ALL by source"
```

- [ ] **Step 6: Add a smoke test under `supabase/functions/signals-window/test.ts`**

This is documentation more than CI — the test hits the deployed endpoint
and verifies non-empty output:
```ts
// Run: deno test --allow-net --allow-env supabase/functions/signals-window/test.ts
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const URL = 'https://wbtlgbmddaxeqhdntnxa.supabase.co/functions/v1/signals-window';

Deno.test('signals-window returns non-empty for known session', async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: '8ac70c7f-890b-55cd-9b00-7d98cb2dc313',
      signal_ids: [/* fill with a real BMS signal_id */],
      start: '2026-05-17T22:33:10.703Z',
      end:   '2026-05-17T22:34:51.658Z',
      bucket_secs: 1,
    }),
  });
  const json = await res.json();
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error(`expected rows, got ${JSON.stringify(json).slice(0, 200)}`);
  }
});
```

Commit:
```bash
git add supabase/functions/signals-window/test.ts
git commit -m "supabase: signals-window smoke test"
```

---

## Task 4: Swap website adapter to Edge Function

**Files:**
- Modify: `frontend/interface/src/adapters/useSupabaseFrames.ts`
- Delete: `frontend/interface/src/adapters/bucketFor.ts`
- Delete: `frontend/interface/src/adapters/bucketFor.test.ts`

- [ ] **Step 1: Replace the bucket calculation block**

In `frontend/interface/src/adapters/useSupabaseFrames.ts` lines 62-65,
replace:
```ts
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);
```
with:
```ts
    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(0.001, (endMs - startMs) / 1000);
    const bucketSecs = durationSecs / (args.targetBuckets ?? 800);
```

- [ ] **Step 2: Replace the RPC call with an Edge Function invoke**

Find the `supabase.rpc('get_signals_window', { p_session_id: ..., ... })`
block (around line 92). Replace with:
```ts
    supabase.functions.invoke('signals-window', {
      body: {
        session_id: args.sessionId,
        signal_ids: toFetch,
        start: args.start,
        end: args.end,
        bucket_secs: bucketSecs,
      },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('signals-window failed', error);
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      store.ingest((data ?? []) as RpcRow[]);
      cache.recordFetch(args.sessionId!, toFetch, args.start!, args.end!, bucketSecs);
      setStatus({ kind: 'ready' });
    });
```

- [ ] **Step 3: Drop the now-unused `bucketFor` import**

Remove `import { bucketFor } from './bucketFor';` at the top.

- [ ] **Step 4: Verify no other importers**

```bash
grep -rn "from .*bucketFor\|bucketFor(" frontend/interface/src
```
Expected: zero matches.

- [ ] **Step 5: Delete bucketFor files**

```bash
rm frontend/interface/src/adapters/bucketFor.ts \
   frontend/interface/src/adapters/bucketFor.test.ts
```

- [ ] **Step 6: Update the adapter test if it pinned the integer bucket**

```bash
cd .worktrees/website-parity/frontend/interface && npm test -- adapters/useSupabaseFrames.test.ts
```
If the test asserts `p_bucket_secs: 1` or similar, update it to expect a
`functions.invoke('signals-window', { body: { bucket_secs: <fractional> } })`
call shape. Use vitest's `vi.spyOn` on `supabase.functions.invoke`.

- [ ] **Step 7: Run all frontend tests**

```bash
cd .worktrees/website-parity/frontend/interface && npm test
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/interface/src/adapters/useSupabaseFrames.ts \
        frontend/interface/src/adapters/bucketFor.ts \
        frontend/interface/src/adapters/bucketFor.test.ts \
        frontend/interface/src/adapters/useSupabaseFrames.test.ts
git commit -m "website: fetch replay frames via signals-window edge function (sub-second buckets)"
```

---

## Task 5: End-to-end smoke test in the browser

**Files:** none modified.

- [ ] **Step 1: Start dev server**

```bash
cd .worktrees/website-parity/frontend/interface && npm run dev
```

- [ ] **Step 2: Open a known session**

Navigate to:
```
http://localhost:5173/app?session=8ac70c7f-890b-55cd-9b00-7d98cb2dc313&mode=replay
```

- [ ] **Step 3: Confirm graph renders**

Add a signal to a graph widget; verify a non-empty curve appears. Open
DevTools Network tab and confirm the `signals-window` call returns 200 with
JSON.

- [ ] **Step 4: Confirm signal filter works**

Open a widget's signal-picker dropdown. Confirm only signals from
`get_session_signal_ids` appear (e.g. BMS, ECU, DAQ-IMU sources for this
session — not the full catalog).

- [ ] **Step 5: Confirm sub-second buckets**

Zoom the graph timeline to a 5-second window. Confirm the curve is dense
(many samples), not stair-stepped.

- [ ] **Step 6: Kill dev server**

`Ctrl-C` and then verify:
```bash
lsof -i :5173 || echo "port free"
```
Expected: `port free`.

- [ ] **Step 7: No commit; report findings**

If anything failed, file a follow-up task in the plan and stop. Otherwise
proceed to Task 6.

---

## Task 6: Add `source` to `SessionListItem`

**Files:**
- Modify: `frontend/interface/src/adapters/useSessionList.ts`

- [ ] **Step 1: Add `source` field**

In `frontend/interface/src/adapters/useSessionList.ts`:
```ts
export interface SessionListItem {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number;
  driver: string | null;
  car: string | null;
  session_number: number | null;
  source: string | null;
}
```

- [ ] **Step 2: Run tests**

```bash
cd .worktrees/website-parity/frontend/interface && npm test
```
Expected: all pass (no test asserts on this field yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/adapters/useSessionList.ts
git commit -m "website: expose session source on SessionListItem"
```

---

## Task 7: Write failing test for desktop-style SessionPicker

**Files:**
- Create: `frontend/interface/src/components/SessionPicker.test.jsx`

- [ ] **Step 1: Write the test**

Create `frontend/interface/src/components/SessionPicker.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SessionPicker from './SessionPicker';

const SESSIONS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001',
    date: '2026-04-21', started_at: '2026-04-21T14:23:00Z',
    ended_at: '2026-04-21T14:28:20Z', duration_secs: 320,
    driver: 'Alex', car: null, session_number: 1, source: 'sd_import' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002',
    date: '2026-04-21', started_at: '2026-04-21T15:00:00Z',
    ended_at: '2026-04-21T15:05:00Z', duration_secs: 300,
    driver: 'Sam', car: null, session_number: 2, source: 'sd_import' },
  { id: 'bbbbbbbb-0000-0000-0000-000000000003',
    date: '2026-04-22', started_at: '2026-04-22T10:00:00Z',
    ended_at: '2026-04-22T10:02:00Z', duration_secs: 120,
    driver: null, car: null, session_number: null, source: 'live' },
];

describe('SessionPicker', () => {
  it('opens a calendar; day with 2 sd_import sessions shows the badge', () => {
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('drills into a day; labels do not use #N', () => {
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    fireEvent.click(screen.getByText('21'));
    expect(screen.queryByText(/#1/)).toBeNull();
    expect(screen.queryByText(/#2/)).toBeNull();
    expect(screen.getAllByText('aaaaaaaa').length).toBeGreaterThan(0);
  });

  it('calls onPick on session click', () => {
    const onPick = vi.fn();
    render(<SessionPicker sessions={SESSIONS} currentId={null} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /select session|▾/i }));
    fireEvent.click(screen.getByText('21'));
    fireEvent.click(screen.getAllByText('aaaaaaaa')[0]);
    expect(onPick).toHaveBeenCalledWith('aaaaaaaa-0000-0000-0000-000000000001');
  });
});
```

- [ ] **Step 2: Run; verify it fails for missing module**

```bash
cd .worktrees/website-parity/frontend/interface && npm test -- src/components/SessionPicker.test.jsx
```
Expected: FAIL with "Cannot find module './SessionPicker'".

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/components/SessionPicker.test.jsx
git commit -m "test: SessionPicker calendar UX contract"
```

---

## Task 8: Implement SessionPicker (port from desktop)

**Files:**
- Create: `frontend/interface/src/components/SessionPicker.jsx`

- [ ] **Step 1: Read desktop reference**

```bash
sed -n '1,338p' app/src/components/SessionPicker.tsx
```

- [ ] **Step 2: Create the JSX port**

Create `frontend/interface/src/components/SessionPicker.jsx` with the full
JSX port (calendar grid + day list, inlined `COLORS` constants, `sd_import`
filter, no `#N` numbering). See the full implementation block at the bottom
of this plan in the **Appendix A: SessionPicker.jsx body**.

- [ ] **Step 3: Run picker tests**

```bash
cd .worktrees/website-parity/frontend/interface && npm test -- src/components/SessionPicker.test.jsx
```
Expected: all three tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/interface/src/components/SessionPicker.jsx
git commit -m "website: desktop-style calendar SessionPicker"
```

---

## Task 9: Wire SessionPicker into AppRoute

**Files:**
- Modify: `frontend/interface/src/routes/AppRoute.jsx`
- Delete: `frontend/interface/src/components/DateAndSessionPicker.jsx`
- Delete (conditional): `frontend/interface/src/components/DatePicker.jsx`,
  `DatePicker.css`

- [ ] **Step 1: Swap the import + JSX**

In `frontend/interface/src/routes/AppRoute.jsx`:
- Change `import DateAndSessionPicker from '@/components/DateAndSessionPicker';`
  to `import SessionPicker from '@/components/SessionPicker';`.
- Replace the `<DateAndSessionPicker ... />` block with:
  ```jsx
  <SessionPicker
    sessions={sessions}
    currentId={session?.id ?? null}
    onPick={(id) => setSearch((p) => {
      if (id) p.set('session', id); else p.delete('session');
      p.delete('date');
      return p;
    })}
  />
  ```

- [ ] **Step 2: Remove dead `selectedDate`/`urlDate` logic**

Delete:
- `const urlDate = search.get('date');`
- `const selectedDate = urlDate ?? session?.date ?? new Date().toISOString().split('T')[0];`
- `const setSelectedDate = ...`
- The `useEffect(() => { if (mode !== 'replay' || sessionId) return; ... }, [...])`
  block.

- [ ] **Step 3: Confirm no remaining importers of `DateAndSessionPicker` or `DatePicker`**

```bash
grep -rn "DateAndSessionPicker\|from .*DatePicker" frontend/interface/src
```
Expected: zero matches.

- [ ] **Step 4: Delete orphaned files**

```bash
rm frontend/interface/src/components/DateAndSessionPicker.jsx \
   frontend/interface/src/components/DatePicker.jsx \
   frontend/interface/src/components/DatePicker.css
```

- [ ] **Step 5: Run dev server + smoke test**

```bash
cd .worktrees/website-parity/frontend/interface && npm run dev
```
Open `http://localhost:5173/app`. Confirm calendar UX. Kill the server when
done (verify port 5173 free).

- [ ] **Step 6: Run all tests**

```bash
cd .worktrees/website-parity/frontend/interface && npm test
```
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/interface/src/routes/AppRoute.jsx \
        frontend/interface/src/components/DateAndSessionPicker.jsx \
        frontend/interface/src/components/DatePicker.jsx \
        frontend/interface/src/components/DatePicker.css
git commit -m "website: AppRoute uses SessionPicker; drop dead DateAndSessionPicker"
```

---

## Task 10: Widget parity audit

**Files:** read-only.

- [ ] **Step 1: Confirm workspace resolution**

```bash
ls -la .worktrees/website-parity/frontend/interface/node_modules/@nfr/widgets
```
Expected: symlink to `packages/widgets`.

- [ ] **Step 2: Confirm widgets uses source entrypoint**

```bash
cat packages/widgets/package.json | grep -E '"main"|"types"|"exports"'
```
Expected: `"main": "src/index.ts"`.

- [ ] **Step 3: Smoke-check parity items visually**

While still in dev server, confirm in the website `/app` graph widget:
- Cursor snaps to samples (no interpolation).
- X-axis labels are relative to session start.
- Enum signals render as names.
- Reset-zoom button is present.
- Data-status dot is colored.

If any are missing despite the shared package, note as a follow-up.

- [ ] **Step 4: No commit needed**

---

## Verification checklist

- [ ] `curl -X POST .../signals-window` returns rows for a known session.
- [ ] Website `/app?session=<sid>` renders a graph with real data.
- [ ] `get_session_signal_ids` returns non-empty set; signal-picker filters.
- [ ] Sub-second zoom looks dense.
- [ ] Session picker is calendar UX, no `#N`.
- [ ] `git diff --stat main` shows no changes under `app/`, `desktop/`,
      `parser/`, or `packages/widgets/`.
- [ ] All `vitest` and `deno test` suites pass.

---

## Appendix A: SessionPicker.jsx body

Use this as the file content in Task 8 Step 2:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react';

const COLORS = {
  bg: '#1e1f22',
  bgInner: '#2b2d30',
  border: 'rgba(255,255,255,0.09)',
  text: '#dfe1e5',
  textMute: '#9da0a8',
  textFaint: '#6b6e76',
  accentBright: '#a78bfa',
};

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW_LABELS = ['S','M','T','W','T','F','S'];

function smallBtn() {
  return {
    display: 'inline-flex', alignItems: 'center', padding: '3px 7px',
    background: 'transparent', border: `1px solid ${COLORS.border}`,
    color: COLORS.textMute, fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10, letterSpacing: 0.5, cursor: 'pointer',
    borderRadius: 2, textTransform: 'uppercase',
  };
}

function CalendarPanel({ cursor, cells, onPrev, onNext, onToday, onPickDate, emptyHint }) {
  const today = new Date();
  const todayIso =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return (
    <div style={{ padding: 12, fontFamily: '"JetBrains Mono", monospace' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 10 }}>
        <button onClick={onPrev} style={{ ...smallBtn(), padding:'2px 8px' }}>‹</button>
        <span style={{ fontSize: 11, color: COLORS.text, letterSpacing: 1, fontWeight: 600 }}>
          {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
        </span>
        <div style={{ display:'flex', gap: 4 }}>
          <button onClick={onToday} style={{ ...smallBtn(), padding:'2px 6px', fontSize: 9 }}>TODAY</button>
          <button onClick={onNext} style={{ ...smallBtn(), padding:'2px 8px' }}>›</button>
        </div>
      </div>
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 2,
        marginBottom: 4, fontSize: 9, color: COLORS.textFaint,
      }}>
        {DOW_LABELS.map((d, i) => (
          <span key={i} style={{ textAlign:'center', padding:'2px 0' }}>{d}</span>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((c) => {
          const has = c.sessions > 0;
          const isToday = c.iso === todayIso;
          const dim = !c.inMonth;
          return (
            <button
              key={c.iso}
              onClick={() => has && onPickDate(c.iso)}
              disabled={!has}
              style={{
                aspectRatio:'1 / 1', padding: 0,
                background: has ? 'rgba(167,139,250,0.22)' : 'transparent',
                border: isToday
                  ? `1px solid ${COLORS.accentBright}`
                  : `1px solid ${has ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.05)'}`,
                color: has ? COLORS.text : dim ? COLORS.textFaint : COLORS.textMute,
                cursor: has ? 'pointer' : 'default',
                fontFamily:'"JetBrains Mono", monospace', fontSize: 10,
                display:'flex', alignItems:'center', justifyContent:'center',
                position:'relative', opacity: dim ? 0.4 : 1,
              }}
              title={has ? `${c.sessions} session${c.sessions === 1 ? '' : 's'}` : ''}
            >
              {c.date.getDate()}
              {has && c.sessions > 1 && (
                <span style={{
                  position:'absolute', bottom: 2, right: 4,
                  fontSize: 8, color: COLORS.accentBright,
                }}>
                  {c.sessions}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {emptyHint && (
        <div style={{ marginTop: 10, fontSize: 9, color: COLORS.textFaint, textAlign:'center' }}>
          {emptyHint}
        </div>
      )}
    </div>
  );
}

function SessionDayList({ date, sessions, currentId, onPick, onBack }) {
  return (
    <div style={{ fontFamily:'"JetBrains Mono", monospace' }}>
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 12px', borderBottom:`1px solid ${COLORS.border}`,
      }}>
        <button onClick={onBack} style={{ ...smallBtn(), padding:'2px 8px', fontSize: 9 }}>← BACK</button>
        <span style={{ fontSize: 10, color: COLORS.textMute, letterSpacing: 1 }}>
          {date} · {sessions.length} session{sessions.length === 1 ? '' : 's'}
        </span>
      </div>
      {sessions.map((s) => {
        const active = s.id === currentId;
        return (
          <div
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              padding:'10px 12px', borderBottom:`1px solid ${COLORS.border}`,
              cursor:'pointer',
              background: active ? 'rgba(167,139,250,0.12)' : 'transparent',
              fontSize: 10, color: COLORS.text,
            }}
          >
            <div style={{ display:'flex', justifyContent:'space-between', gap: 8 }}>
              <span>{new Date(s.started_at).toLocaleTimeString()}</span>
              <span style={{ color: COLORS.textFaint, fontSize: 9 }}>
                {s.id.slice(0, 8)}
              </span>
            </div>
            {(s.driver || s.car) && (
              <div style={{
                marginTop: 2, color: COLORS.textMute, fontSize: 9, display:'flex', gap: 8,
              }}>
                {s.driver && <span>{s.driver}</span>}
                {s.car && <span>· {s.car}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SessionPicker({ sessions, currentId, onPick }) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const autoJumpedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSelectedDate(null);
      autoJumpedRef.current = false;
    }
  }, [open]);

  const sdSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.source === 'sd_import'),
    [sessions],
  );

  useEffect(() => {
    if (!open || autoJumpedRef.current) return;
    if (sdSessions.length === 0) { autoJumpedRef.current = true; return; }
    const latest = sdSessions.reduce((acc, s) => (s.date > acc ? s.date : acc), sdSessions[0].date);
    const [y, m] = latest.split('-').map((x) => parseInt(x, 10));
    if (y && m) setCursor(new Date(y, m - 1, 1));
    autoJumpedRef.current = true;
  }, [open, sdSessions]);

  const dayMap = useMemo(() => {
    const m = new Map();
    for (const s of sdSessions) {
      const arr = m.get(s.date);
      if (arr) arr.push(s);
      else m.set(s.date, [s]);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
    }
    return m;
  }, [sdSessions]);

  const current = sessions?.find((s) => s.id === currentId);
  const label = currentId
    ? current
      ? `${new Date(current.started_at).toLocaleDateString()} · ${currentId.slice(0, 8)}`
      : currentId.slice(0, 8)
    : 'Select session';

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startSunday = new Date(firstOfMonth);
    startSunday.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      out.push({
        date: d, iso,
        inMonth: d.getMonth() === cursor.getMonth(),
        sessions: dayMap.get(iso)?.length ?? 0,
      });
    }
    return out;
  }, [cursor, dayMap]);

  const dropdownStyle = {
    position:'absolute', top:'calc(100% + 4px)', right: 0,
    width: 380, maxHeight: 460, overflow:'auto',
    background: COLORS.bg, border:`1px solid ${COLORS.border}`,
    zIndex: 51, boxShadow:'0 8px 24px rgba(0,0,0,0.55)',
  };

  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...smallBtn(), color: COLORS.text, padding:'4px 10px' }}>
        {label} ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset: 0, zIndex: 50 }} />
          <div style={dropdownStyle}>
            {selectedDate ? (
              <SessionDayList
                date={selectedDate}
                sessions={dayMap.get(selectedDate) ?? []}
                currentId={currentId}
                onPick={(id) => { onPick(id); setOpen(false); }}
                onBack={() => setSelectedDate(null)}
              />
            ) : (
              <CalendarPanel
                cursor={cursor}
                cells={cells}
                onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                onToday={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}
                onPickDate={(iso) => setSelectedDate(iso)}
                emptyHint={sdSessions.length === 0 ? 'No imported sessions yet' : null}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
```
