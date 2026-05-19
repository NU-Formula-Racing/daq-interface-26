# Desktop Replay: Lazy Per-Signal Fetch + Min/Max Band — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop replay route fetch data per-signal, per-visible-window, and render a min/max band so transient spikes are visible even at coarse zoom. Retire the bulk `get_session_overview` preload entirely.

**Architecture:** Three layers (catalog · per-session signal IDs · lazy bucketed values). New Layer-3 fetch uses the existing `get_signals_window` RPC, widened to `NUMERIC` `p_bucket_secs` so sub-second buckets work locally. Bucket size is computed client-side from the visible time range. The same code path produces averaged points at coarse zoom and effectively-raw samples at deep zoom (zero-row empty buckets, single-row populated buckets — no client branch).

**Tech Stack:** Electron + Fastify backend (`desktop/main/`), React 19 + Vite frontend (`app/`), shared widgets (`@nfr/widgets`), Vitest, local Postgres via `pg` Pool.

**Spec:** `docs/superpowers/specs/2026-05-19-desktop-replay-lazy-fetch-design.md`

---

## File Structure

**New files:**
- `desktop/migrations/0007_session_signal_ids_and_numeric_bucket.sql` — adds `get_session_signal_ids`, redefines `get_signals_window` with `NUMERIC` bucket, drops `get_session_overview`.
- `app/src/hooks/useReplayFrames.ts` — lazy per-signal, LRU-cached replay fetcher; exposes a `FramesStore`.
- `app/src/hooks/useReplayFrames.test.ts` — tests for the hook.
- `app/src/hooks/useSessionSignalIds.ts` — Layer 2 hook calling `/api/sessions/:id/signal-ids`.
- `app/src/hooks/useSessionSignalIds.test.ts` — tests.
- `app/src/lib/replayFramesCache.ts` — desktop-local copy of the website's `framesCache` (deliberately not shared via the monorepo because the website uses `@/lib/lru` path-alias; we keep both copies small and parallel).
- `app/src/lib/replayFramesCache.test.ts`.
- `app/src/lib/lru.ts` (+ test) — same 30-line LRU as the website.

**Modified files:**
- `desktop/main/src/db/signals.ts` — add `getSessionSignalIds`, `getSignalsWindow`.
- `desktop/main/src/db/sessions.ts` — remove `getSessionOverview`.
- `desktop/main/src/server/routes/signals.ts` — add `GET /api/sessions/:id/signal-ids`, `GET /api/sessions/:id/signals/window`.
- `desktop/main/src/server/routes/sessions.ts` — remove `/overview` route.
- `desktop/main/tests/db/rpcs.test.ts` — tests for the two changed RPCs; drop overview test.
- `app/src/api/types.ts` — remove `OverviewRow`, add `SignalWindowRow`.
- `app/src/pages/Replay.tsx` — swap `useOverview` + `makeReplayStore` → `useReplayFrames`; pass zoom into the hook.
- `app/src/hooks/useOverview.ts` — delete.
- `packages/widgets/src/widgets/widgets.tsx` — render min/max band in `GraphWidget` when `vMin`/`vMax` populated; add `showRange` config flag (default `true`).

**Out of scope** (per spec): live mode, CSV export, per-widget independent zoom, cloud `get_session_overview` cleanup.

---

## Task 1: DB migration — new RPC + widen bucket type + drop overview

**Files:**
- Create: `desktop/migrations/0007_session_signal_ids_and_numeric_bucket.sql`

- [ ] **Step 1: Write the migration**

Create `desktop/migrations/0007_session_signal_ids_and_numeric_bucket.sql`:

```sql
-- get_session_signal_ids: distinct signal IDs that have at least one row in
-- sd_readings for a given session. Loose index scan via recursive CTE — see
-- frontend/database/supabase_functions.sql for the cloud equivalent and the
-- rationale (plain SELECT DISTINCT reads every matching row).
CREATE OR REPLACE FUNCTION get_session_signal_ids(p_session_id UUID)
RETURNS TABLE (signal_id SMALLINT)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE t AS (
    (
      SELECT r.signal_id
      FROM sd_readings r
      WHERE r.session_id = p_session_id
      ORDER BY r.signal_id
      LIMIT 1
    )
    UNION ALL
    SELECT (
      SELECT r.signal_id
      FROM sd_readings r
      WHERE r.session_id = p_session_id
        AND r.signal_id > t.signal_id
      ORDER BY r.signal_id
      LIMIT 1
    )
    FROM t
    WHERE t.signal_id IS NOT NULL
  )
  SELECT t.signal_id FROM t WHERE t.signal_id IS NOT NULL ORDER BY t.signal_id;
END;
$$;

-- get_signals_window: widen p_bucket_secs from INT to NUMERIC so sub-second
-- buckets work. PG can't change a function's parameter list with CREATE OR
-- REPLACE, so we DROP and recreate.
DROP FUNCTION IF EXISTS get_signals_window(UUID, SMALLINT[], TIMESTAMPTZ, TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION get_signals_window(
  p_session_id   UUID,
  p_signal_ids   SMALLINT[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  NUMERIC
)
RETURNS TABLE (
  ts          TIMESTAMPTZ,
  signal_id   SMALLINT,
  signal_name TEXT,
  unit        TEXT,
  value_min   DOUBLE PRECISION,
  value_max   DOUBLE PRECISION,
  value_avg   DOUBLE PRECISION,
  sample_n    INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM r.ts) / p_bucket_secs) * p_bucket_secs) AT TIME ZONE 'UTC' AS ts,
    r.signal_id,
    d.signal_name,
    d.unit,
    min(r.value)            AS value_min,
    max(r.value)            AS value_max,
    avg(r.value)            AS value_avg,
    count(*)::INT           AS sample_n
  FROM sd_readings r
  JOIN signal_definitions d ON d.id = r.signal_id
  WHERE r.session_id = p_session_id
    AND r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4
  ORDER BY 1;
$$;

-- get_session_overview is retired — desktop replay no longer preloads the
-- whole session as bucketed rows.
DROP FUNCTION IF EXISTS get_session_overview(UUID, INT);
```

- [ ] **Step 2: Apply the migration locally**

The desktop's `migrate.ts` runs migrations in order on startup against the local pg instance managed by `postgres-manager.ts`. For dev, the easiest path is:

```
cd desktop/main && npx vitest run tests/db/migrate.test.ts
```

If that test doesn't already cover applying every migration in order, just launch the desktop app once (`npm run dev` from the desktop workspace if available, else `npm run --workspace=desktop dev`) and observe in the console that the migration applied. If you don't have a clean dev launch path, ask the controller.

- [ ] **Step 3: Smoke test the new RPC**

Pick any session in your local DB:

```
psql "$(node -e "console.log(require('./desktop/main/src/db/config').dsn())")" -c "
  SELECT count(*) FROM get_session_signal_ids((SELECT id FROM sessions LIMIT 1));"
```

If you don't know the DSN, the test runner uses `pg-mem` or a fixture pool — see `desktop/main/tests/db/rpcs.test.ts` for the pattern. Don't block on this step; the RPC tests in Task 4 are the real verification.

- [ ] **Step 4: Commit**

```bash
git add desktop/migrations/0007_session_signal_ids_and_numeric_bucket.sql
git commit -m "db: add get_session_signal_ids; widen get_signals_window bucket to NUMERIC; drop get_session_overview"
```

---

## Task 2: Desktop DB helpers

**Files:**
- Modify: `desktop/main/src/db/signals.ts`
- Modify: `desktop/main/src/db/sessions.ts`

- [ ] **Step 1: Add the new helpers in signals.ts**

Open `desktop/main/src/db/signals.ts`. Add the new exported types and functions (do not delete the existing `getSignalWindow` — it's still useful for raw single-signal queries elsewhere). Append:

```ts
export interface SignalWindowRow {
  ts: string;          // ISO
  signal_id: number;
  signal_name: string;
  unit: string | null;
  value_min: number;
  value_max: number;
  value_avg: number;
  sample_n: number;
}

export async function getSessionSignalIds(
  pool: pg.Pool,
  sessionId: string
): Promise<number[]> {
  const { rows } = await pool.query<{ signal_id: number }>(
    `SELECT signal_id FROM get_session_signal_ids($1)`,
    [sessionId]
  );
  return rows.map((r) => r.signal_id);
}

export async function getSignalsWindow(
  pool: pg.Pool,
  sessionId: string,
  signalIds: number[],
  start: string,
  end: string,
  bucketSecs: number
): Promise<SignalWindowRow[]> {
  if (signalIds.length === 0) return [];
  const { rows } = await pool.query<{
    ts: Date;
    signal_id: number;
    signal_name: string;
    unit: string | null;
    value_min: string;
    value_max: string;
    value_avg: string;
    sample_n: number;
  }>(
    `SELECT ts, signal_id, signal_name, unit, value_min, value_max, value_avg, sample_n
     FROM get_signals_window($1, $2::smallint[], $3::timestamptz, $4::timestamptz, $5::numeric)`,
    [sessionId, signalIds, start, end, bucketSecs]
  );
  return rows.map((r) => ({
    ts: r.ts.toISOString(),
    signal_id: r.signal_id,
    signal_name: r.signal_name,
    unit: r.unit,
    value_min: Number(r.value_min),
    value_max: Number(r.value_max),
    value_avg: Number(r.value_avg),
    sample_n: r.sample_n,
  }));
}
```

- [ ] **Step 2: Remove the overview helper in sessions.ts**

Open `desktop/main/src/db/sessions.ts`. Delete the `getSessionOverview` function (lines ~92–110 in the current file) and any `OverviewRow` import/export it depends on. If `OverviewRow` is declared in this file, delete the interface too.

Also remove `getSessionOverview` from any default-export or barrel re-export in the same file.

- [ ] **Step 3: Sanity check**

```
cd desktop/main && npx tsc --noEmit
```

Expected: no new errors. The `signals.ts` additions should compile; you may see follow-on errors in `routes/sessions.ts` because it still imports `getSessionOverview` — that's expected, Task 3 fixes it.

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/db/signals.ts desktop/main/src/db/sessions.ts
git commit -m "desktop/db: add getSessionSignalIds + getSignalsWindow; drop getSessionOverview helper"
```

---

## Task 3: Desktop HTTP routes

**Files:**
- Modify: `desktop/main/src/server/routes/signals.ts`
- Modify: `desktop/main/src/server/routes/sessions.ts`

- [ ] **Step 1: Update signal routes**

Open `desktop/main/src/server/routes/signals.ts`. Replace its contents with:

```ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  getSessionSignalIds,
  getSignalsWindow,
  getSignalWindow,
  listSignalDefinitions,
} from '../../db/signals.ts';

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

  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/signal-ids',
    async (req) => getSessionSignalIds(pool, req.params.id)
  );

  app.get<{
    Params: { id: string };
    Querystring: { ids: string; start: string; end: string; bucket: string };
  }>(
    '/api/sessions/:id/signals/window',
    async (req, reply) => {
      const { ids, start, end, bucket } = req.query;
      if (!ids || !start || !end || !bucket) {
        reply.code(400);
        return { error: 'missing_query_param' };
      }
      const signalIds = ids
        .split(',')
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));
      const bucketSecs = Number(bucket);
      if (!Number.isFinite(bucketSecs) || bucketSecs <= 0) {
        reply.code(400);
        return { error: 'invalid_bucket' };
      }
      return getSignalsWindow(pool, req.params.id, signalIds, start, end, bucketSecs);
    }
  );
}
```

- [ ] **Step 2: Update session routes**

Open `desktop/main/src/server/routes/sessions.ts`. Remove the `/api/sessions/:id/overview` route (the trailing `app.get<...>(...)` block) and remove the `getSessionOverview` import.

- [ ] **Step 3: Build and typecheck**

```
cd desktop/main && npx tsc --noEmit
```

Expected: clean. Lingering ts errors should now be only in `app/src/hooks/useOverview.ts` (we'll delete that file in Task 8).

- [ ] **Step 4: Commit**

```bash
git add desktop/main/src/server/routes/signals.ts desktop/main/src/server/routes/sessions.ts
git commit -m "desktop/routes: add /signal-ids + /signals/window; remove /overview"
```

---

## Task 4: RPC tests

**Files:**
- Modify: `desktop/main/tests/db/rpcs.test.ts`

- [ ] **Step 1: Read the existing test to learn the harness**

```
cat desktop/main/tests/db/rpcs.test.ts
```

Identify how it provisions a pool and seeds data. Tests below should follow the same pattern (whether it's a real pg connection, pg-mem, a test container, or a fixture).

- [ ] **Step 2: Add tests for the two functions and remove the overview test**

Inside the existing `describe(...)` block, **delete** the test for `get_session_overview` (it'll start failing once the migration is applied anyway). Then add:

```ts
it('get_session_signal_ids returns distinct signal IDs for a session', async () => {
  const { rows } = await pool.query(
    `SELECT signal_id FROM get_session_signal_ids($1) ORDER BY signal_id`,
    [TEST_SESSION_ID]
  );
  const ids = rows.map((r: any) => r.signal_id);
  // Compare against the truth set
  const { rows: truth } = await pool.query(
    `SELECT DISTINCT signal_id FROM sd_readings
     WHERE session_id = $1 ORDER BY signal_id`,
    [TEST_SESSION_ID]
  );
  expect(ids).toEqual(truth.map((r: any) => r.signal_id));
});

it('get_signals_window accepts NUMERIC bucket_secs and returns envelope columns', async () => {
  // Coarse bucket: many samples per bucket; value_min should be ≤ value_avg ≤ value_max.
  const { rows: coarse } = await pool.query(
    `SELECT * FROM get_signals_window($1, $2::smallint[], $3::timestamptz, $4::timestamptz, 1.0::numeric)`,
    [TEST_SESSION_ID, TEST_SIGNAL_IDS, TEST_START, TEST_END]
  );
  expect(coarse.length).toBeGreaterThan(0);
  for (const r of coarse) {
    expect(Number(r.value_min)).toBeLessThanOrEqual(Number(r.value_avg));
    expect(Number(r.value_avg)).toBeLessThanOrEqual(Number(r.value_max));
    expect(Number(r.sample_n)).toBeGreaterThan(0);
  }

  // Sub-second bucket: per spec we expect smaller groupings.
  const { rows: fine } = await pool.query(
    `SELECT * FROM get_signals_window($1, $2::smallint[], $3::timestamptz, $4::timestamptz, 0.05::numeric)`,
    [TEST_SESSION_ID, TEST_SIGNAL_IDS, TEST_START, TEST_END]
  );
  expect(fine.length).toBeGreaterThanOrEqual(coarse.length); // finer buckets ⇒ ≥ rows
});
```

Use whichever constants the existing tests use for session/signals/timestamps. If the existing harness doesn't make those readily available, add a `beforeAll` that inserts a known fixture (1 minute of data, 100 Hz, 2 signals).

- [ ] **Step 3: Run tests**

```
cd desktop/main && npx vitest run tests/db/rpcs.test.ts
```

Expected: PASS for the new tests; the old `get_session_overview` test should be gone.

- [ ] **Step 4: Commit**

```bash
git add desktop/main/tests/db/rpcs.test.ts
git commit -m "desktop/tests: rpcs cover get_session_signal_ids + NUMERIC bucket window; drop overview test"
```

---

## Task 5: API types

**Files:**
- Modify: `app/src/api/types.ts`

- [ ] **Step 1: Edit types**

Open `app/src/api/types.ts`:

- Delete the `OverviewRow` interface.
- Add:

```ts
export interface SignalWindowRow {
  ts: string;
  signal_id: number;
  signal_name: string;
  unit: string | null;
  value_min: number;
  value_max: number;
  value_avg: number;
  sample_n: number;
}
```

- Keep `WindowRow` (used by the existing single-signal raw route).

- [ ] **Step 2: Commit**

```bash
git add app/src/api/types.ts
git commit -m "app/types: replace OverviewRow with SignalWindowRow"
```

---

## Task 6: LRU helper

**Files:**
- Create: `app/src/lib/lru.ts`
- Create: `app/src/lib/lru.test.ts`

This is a verbatim copy of the website's `frontend/interface/src/lib/lru.ts` (same 30 lines). We keep it locally so we don't drag `frontend/interface` into the desktop's import graph.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/lru.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LRU } from './lru';

describe('LRU', () => {
  it('evicts least-recently-used on overflow', () => {
    const c = new LRU<string, number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    c.get('a'); // refresh a
    c.set('d', 4);
    expect(c.get('b')).toBeUndefined(); // b evicted
    expect(c.get('a')).toBe(1);
  });

  it('has() does not promote', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.has('a');
    c.set('c', 3); // should evict a (oldest by insertion since has() didn't touch)
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
  });

  it('overwriting a key updates recency', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.set('a', 11);
    c.set('c', 3);
    expect(c.get('a')).toBe(11);
    expect(c.get('b')).toBeUndefined();
  });

  it('delete and clear', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1);
    expect(c.delete('a')).toBe(true);
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test (red)**

```
cd app && npx vitest run src/lib/lru.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/src/lib/lru.ts`:

```ts
/**
 * Map-backed LRU. Map preserves insertion order; deleting + re-setting moves
 * a key to most-recent. On overflow we evict the first key.
 */
export class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private cap: number) {
    if (cap <= 0) throw new Error('LRU cap must be > 0');
  }

  get size(): number { return this.map.size; }

  has(key: K): boolean { return this.map.has(key); }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: K): boolean { return this.map.delete(key); }

  clear(): void { this.map.clear(); }
}
```

- [ ] **Step 4: Run test (green)**

```
cd app && npx vitest run src/lib/lru.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/lru.ts app/src/lib/lru.test.ts
git commit -m "app/lib: LRU helper for replay frames cache"
```

---

## Task 7: Replay frames cache

**Files:**
- Create: `app/src/lib/replayFramesCache.ts`
- Create: `app/src/lib/replayFramesCache.test.ts`

Parallel to the website's `frontend/interface/src/adapters/framesCache.ts`. The cache stores "have we asked for it" markers per `(session, signal, window, bucket)` — NOT the row data itself (which lives in `ReplayFramesStore` from Task 8).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/replayFramesCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ReplayFramesCache, frameCacheKey } from './replayFramesCache';

describe('frameCacheKey', () => {
  it('is stable across signal-id order', () => {
    expect(frameCacheKey('s1', [3, 1, 2], 'a', 'b', 0.5))
      .toBe(frameCacheKey('s1', [1, 2, 3], 'a', 'b', 0.5));
  });
});

describe('ReplayFramesCache', () => {
  it('records per signal id and returns the missing subset', () => {
    const c = new ReplayFramesCache(8);
    c.recordFetch('s1', [1, 2], 'a', 'b', 0.5);
    expect(c.missing('s1', [1, 2, 3], 'a', 'b', 0.5)).toEqual([3]);
  });

  it('different window or bucket gives a different key', () => {
    const c = new ReplayFramesCache(8);
    c.recordFetch('s1', [1], 'a', 'b', 0.5);
    expect(c.missing('s1', [1], 'a', 'b', 0.5)).toEqual([]);
    expect(c.missing('s1', [1], 'a', 'b', 0.05)).toEqual([1]);
    expect(c.missing('s1', [1], 'a', 'c', 0.5)).toEqual([1]);
  });

  it('resetSession drops only that session', () => {
    const c = new ReplayFramesCache(8);
    c.recordFetch('s1', [1], 'a', 'b', 0.5);
    c.recordFetch('s2', [1], 'a', 'b', 0.5);
    c.resetSession('s1');
    expect(c.missing('s1', [1], 'a', 'b', 0.5)).toEqual([1]);
    expect(c.missing('s2', [1], 'a', 'b', 0.5)).toEqual([]);
  });

  it('LRU evicts oldest beyond cap', () => {
    const c = new ReplayFramesCache(2);
    c.recordFetch('s1', [1], 'a', 'b', 0.5);
    c.recordFetch('s1', [2], 'a', 'b', 0.5);
    c.recordFetch('s1', [3], 'a', 'b', 0.5); // evicts the [1] entry
    expect(c.missing('s1', [1], 'a', 'b', 0.5)).toEqual([1]);
    expect(c.missing('s1', [2], 'a', 'b', 0.5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test (red)**

```
cd app && npx vitest run src/lib/replayFramesCache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/src/lib/replayFramesCache.ts`:

```ts
import { LRU } from './lru';

export function frameCacheKey(
  sessionId: string,
  signalIds: readonly number[],
  start: string,
  end: string,
  bucketSecs: number,
): string {
  const ids = [...signalIds].sort((a, b) => a - b).join(',');
  return `${sessionId}|${start}|${end}|${bucketSecs}|${ids}`;
}

/**
 * Tracks which (session, signal, window, bucket) tuples have already been
 * fetched. Stores only markers — row data lives in the FramesStore.
 */
export class ReplayFramesCache {
  private byKey: LRU<string, true>;
  private bySession = new Map<string, Set<string>>();

  constructor(cap = 64) {
    this.byKey = new LRU<string, true>(cap);
  }

  recordFetch(
    sessionId: string,
    signalIds: readonly number[],
    start: string,
    end: string,
    bucketSecs: number,
  ): void {
    let set = this.bySession.get(sessionId);
    if (!set) { set = new Set(); this.bySession.set(sessionId, set); }
    for (const id of signalIds) {
      const k = frameCacheKey(sessionId, [id], start, end, bucketSecs);
      this.byKey.set(k, true);
      set.add(k);
    }
  }

  missing(
    sessionId: string,
    signalIds: readonly number[],
    start: string,
    end: string,
    bucketSecs: number,
  ): number[] {
    return signalIds.filter((id) =>
      !this.byKey.has(frameCacheKey(sessionId, [id], start, end, bucketSecs)),
    );
  }

  resetSession(sessionId: string): void {
    const set = this.bySession.get(sessionId);
    if (!set) return;
    for (const k of set) this.byKey.delete(k);
    this.bySession.delete(sessionId);
  }
}
```

- [ ] **Step 4: Run test (green)**

```
cd app && npx vitest run src/lib/replayFramesCache.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/replayFramesCache.ts app/src/lib/replayFramesCache.test.ts
git commit -m "app/lib: replay frames cache keyed by (session, signal, window, bucket)"
```

---

## Task 8: `useSessionSignalIds` hook

**Files:**
- Create: `app/src/hooks/useSessionSignalIds.ts`
- Create: `app/src/hooks/useSessionSignalIds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/useSessionSignalIds.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionSignalIds } from './useSessionSignalIds';

vi.mock('../api/client.ts', () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from '../api/client.ts';
const mApi = apiGet as unknown as ReturnType<typeof vi.fn>;

describe('useSessionSignalIds', () => {
  beforeEach(() => { mApi.mockReset(); });

  it('returns empty set + idle when sessionId is null', () => {
    const { result } = renderHook(() => useSessionSignalIds(null));
    expect(result.current.ids.size).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(mApi).not.toHaveBeenCalled();
  });

  it('fetches and exposes ids as a Set', async () => {
    mApi.mockResolvedValueOnce([1, 5, 9]);
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mApi).toHaveBeenCalledWith('/api/sessions/sess-1/signal-ids');
    expect([...result.current.ids].sort()).toEqual([1, 5, 9]);
  });

  it('reports error status when fetch fails', async () => {
    mApi.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ids.size).toBe(0);
  });
});
```

If `@testing-library/react` isn't a desktop dev dep yet, install it (the desktop app uses Vitest with `jsdom` already — check `app/vitest.config.ts`):

```
cd app && npm i -D @testing-library/react @testing-library/dom
```

- [ ] **Step 2: Run test (red)**

```
cd app && npx vitest run src/hooks/useSessionSignalIds.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/src/hooks/useSessionSignalIds.ts`:

```ts
import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.ts';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface UseSessionSignalIdsResult {
  ids: Set<number>;
  status: Status;
  error: string | null;
}

/** Layer 2: signal IDs that have data in the given session. One cheap RPC. */
export function useSessionSignalIds(sessionId: string | null): UseSessionSignalIdsResult {
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setIds(new Set());
      setStatus('idle');
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    apiGet<number[]>(`/api/sessions/${sessionId}/signal-ids`)
      .then((arr) => {
        if (cancelled) return;
        setIds(new Set(arr));
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(String(err));
        setIds(new Set());
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  return { ids, status, error };
}
```

- [ ] **Step 4: Run test (green)**

```
cd app && npx vitest run src/hooks/useSessionSignalIds.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useSessionSignalIds.ts app/src/hooks/useSessionSignalIds.test.ts app/package.json app/package-lock.json
git commit -m "app/hooks: useSessionSignalIds (Layer 2)"
```

---

## Task 9: `useReplayFrames` hook + store

**Files:**
- Create: `app/src/hooks/useReplayFrames.ts`
- Create: `app/src/hooks/useReplayFrames.test.ts`

The hook owns a private `ReplayFramesStore` (small in-file class) that ingests `SignalWindowRow[]` and serves a `FramesStore` interface. Rows carry `vMin`/`vMax`.

- [ ] **Step 1: Write the failing test**

Create `app/src/hooks/useReplayFrames.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useReplayFrames } from './useReplayFrames';

vi.mock('../api/client.ts', () => ({ apiGet: vi.fn() }));

import { apiGet } from '../api/client.ts';
const mApi = apiGet as unknown as ReturnType<typeof vi.fn>;

const baseArgs = {
  sessionId: 'sess-1',
  start: '2026-05-01T00:00:00Z',
  end:   '2026-05-01T00:10:00Z',
};

beforeEach(() => {
  mApi.mockReset();
  mApi.mockResolvedValue([]);
});

describe('useReplayFrames', () => {
  it('does not refetch on toggle off-then-on for the same window', async () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useReplayFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mApi).toHaveBeenCalledTimes(1);

    rerender({ ids: [] });
    rerender({ ids: [1] });
    await new Promise((r) => setTimeout(r, 20));
    expect(mApi).toHaveBeenCalledTimes(1);
  });

  it('only fetches newly added IDs', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useReplayFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(1));
    rerender({ ids: [1, 2, 3] });
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(2));
    const url = mApi.mock.calls[1][0] as string;
    expect(url).toContain('ids=2,3');
  });

  it('resets when sessionId changes', async () => {
    const { rerender } = renderHook(
      ({ sid }: { sid: string }) => useReplayFrames({ ...baseArgs, sessionId: sid, signalIds: [1] }),
      { initialProps: { sid: 'sess-1' } },
    );
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(1));
    rerender({ sid: 'sess-2' });
    await waitFor(() => expect(mApi).toHaveBeenCalledTimes(2));
    expect((mApi.mock.calls[1][0] as string)).toContain('/api/sessions/sess-2/signals/window');
  });

  it('store rows carry vMin/vMax', async () => {
    mApi.mockResolvedValueOnce([
      { ts: '2026-05-01T00:00:01Z', signal_id: 1, signal_name: 'X', unit: null,
        value_min: 1, value_max: 9, value_avg: 5, sample_n: 10 },
    ]);
    const { result } = renderHook(() => useReplayFrames({ ...baseArgs, signalIds: [1] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const series = result.current.store.series(1);
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(5);
    expect(series[0].vMin).toBe(1);
    expect(series[0].vMax).toBe(9);
  });
});
```

- [ ] **Step 2: Run test (red)**

```
cd app && npx vitest run src/hooks/useReplayFrames.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `app/src/hooks/useReplayFrames.ts`:

```ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FrameRow, FramesStore } from '@nfr/widgets';
import { apiGet } from '../api/client.ts';
import type { SignalWindowRow } from '../api/types.ts';
import { ReplayFramesCache } from '../lib/replayFramesCache';

class ReplayFramesStore implements FramesStore {
  private bySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  ingest(rows: SignalWindowRow[]): void {
    const touched = new Set<number>();
    for (const r of rows) {
      const frame: FrameRow = {
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value_avg,
        vMin: r.value_min,
        vMax: r.value_max,
      };
      let buf = this.bySignal.get(r.signal_id);
      if (!buf) { buf = []; this.bySignal.set(r.signal_id, buf); }
      buf.push(frame);
      touched.add(r.signal_id);
      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < frame.ts) this.latestBySignal.set(r.signal_id, frame);
      if (this._firstTs === null || frame.ts < this._firstTs) this._firstTs = frame.ts;
      if (this._latestTs === null || frame.ts > this._latestTs) this._latestTs = frame.ts;
    }
    for (const id of touched) {
      this.bySignal.get(id)!.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  series(id: number): FrameRow[] { return this.bySignal.get(id) ?? []; }
  latest(id: number): FrameRow | null { return this.latestBySignal.get(id) ?? null; }
  firstTs(): string | null { return this._firstTs; }
  latestTs(): string | null { return this._latestTs; }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  getVersion(): number { return this.version; }
  reset(): void {
    this.bySignal.clear();
    this.latestBySignal.clear();
    this._firstTs = null;
    this._latestTs = null;
    this.version++;
    for (const l of this.listeners) l();
  }
}

const TARGET_BUCKETS = 800;

export interface UseReplayFramesArgs {
  sessionId: string | null;
  signalIds: number[];
  start: string | null;
  end: string | null;
}

export function useReplayFrames(args: UseReplayFramesArgs) {
  const storeRef = useRef<ReplayFramesStore>(new ReplayFramesStore());
  const cacheRef = useRef<ReplayFramesCache>(new ReplayFramesCache(64));
  const store = storeRef.current;
  const cache = cacheRef.current;
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const stateRef = useRef<{
    sessionId: string | null;
    start: string | null;
    end: string | null;
    bucketSecs: number | null;
  }>({ sessionId: null, start: null, end: null, bucketSecs: null });

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );

  const idsKey = useMemo(
    () => [...args.signalIds].sort((a, b) => a - b).join(','),
    [args.signalIds],
  );

  useEffect(() => {
    if (!args.sessionId || !args.start || !args.end || args.signalIds.length === 0) {
      setStatus('idle');
      return;
    }

    const durationSecs = Math.max(0.001, (Date.parse(args.end) - Date.parse(args.start)) / 1000);
    const bucketSecs = durationSecs / TARGET_BUCKETS;

    const windowChanged =
      stateRef.current.sessionId !== args.sessionId ||
      stateRef.current.start !== args.start ||
      stateRef.current.end !== args.end ||
      stateRef.current.bucketSecs !== bucketSecs;

    if (windowChanged) {
      if (stateRef.current.sessionId) cache.resetSession(stateRef.current.sessionId);
      store.reset();
      stateRef.current = { sessionId: args.sessionId, start: args.start, end: args.end, bucketSecs };
    }

    const toFetch = cache.missing(args.sessionId, args.signalIds, args.start, args.end, bucketSecs);
    if (toFetch.length === 0) {
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    const url =
      `/api/sessions/${args.sessionId}/signals/window` +
      `?ids=${toFetch.join(',')}` +
      `&start=${encodeURIComponent(args.start)}` +
      `&end=${encodeURIComponent(args.end)}` +
      `&bucket=${bucketSecs}`;
    apiGet<SignalWindowRow[]>(url)
      .then((rows) => {
        if (cancelled) return;
        store.ingest(rows);
        cache.recordFetch(args.sessionId!, toFetch, args.start!, args.end!, bucketSecs);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('useReplayFrames fetch failed', err);
        setStatus('error');
      });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, store, cache]);

  return { store, status };
}
```

- [ ] **Step 4: Run test (green)**

```
cd app && npx vitest run src/hooks/useReplayFrames.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useReplayFrames.ts app/src/hooks/useReplayFrames.test.ts
git commit -m "app/hooks: useReplayFrames (Layer 3: lazy per-signal bucketed fetch)"
```

---

## Task 10: Wire Replay.tsx; delete useOverview

**Files:**
- Modify: `app/src/pages/Replay.tsx`
- Delete: `app/src/hooks/useOverview.ts`

- [ ] **Step 1: Investigate where the dock's zoom range lives**

In the current `Replay.tsx`, each graph widget owns its own `zoom: [t0,t1] | null` in widget config (see `widget.zoom` in `packages/widgets/src/widgets/widgets.tsx:1196`). The dock-level scrubber position is `t: number`.

For this rework we'll define a **dock-level visible window** that the `useReplayFrames` hook consumes:

- If any widget has a non-null zoom, take the *narrowest* zoom (intersection by `max(t0)`/`min(t1)` across all widgets). The simpler v1: just use the most-recently-set zoom — `Replay.tsx` tracks one `[t0, t1] | null` state for the dock.
- Otherwise the visible window is `[sessionStart, sessionEnd]`.

The "narrowest" or "most-recent" semantic should mirror what the user perceives — for v1 use **most-recent** (single piece of state).

- [ ] **Step 2: Rewrite Replay.tsx**

Replace the entire file with:

```tsx
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '@nfr/widgets';
import { SessionPicker } from '../components/SessionPicker.tsx';
import { useReplayFrames } from '../hooks/useReplayFrames.ts';
import { useSessionSignalIds } from '../hooks/useSessionSignalIds.ts';
import type { SessionDetail } from '../api/types.ts';
import { useEffect, useRef } from 'react';
import { apiGet } from '../api/client.ts';

export default function Replay() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<SessionDetail>(`/api/sessions/${id}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setDetailErr(String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  // Single dock-level zoom range. Most-recent-zoom wins (see plan task 10 notes).
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [t, setT] = useState(1);

  // Session bounds drive the visible window.
  const sessionStart = detail?.started_at ?? null;
  const sessionEnd = detail?.ended_at ?? null;
  const durationSecs = useMemo(() => {
    if (!sessionStart || !sessionEnd) return 0;
    return Math.max(0, (Date.parse(sessionEnd) - Date.parse(sessionStart)) / 1000);
  }, [sessionStart, sessionEnd]);

  const visStart = useMemo(() => {
    if (!sessionStart || !sessionEnd || !zoom) return sessionStart;
    return new Date(Date.parse(sessionStart) + zoom[0] * durationSecs * 1000).toISOString();
  }, [sessionStart, sessionEnd, zoom, durationSecs]);
  const visEnd = useMemo(() => {
    if (!sessionStart || !sessionEnd || !zoom) return sessionEnd;
    return new Date(Date.parse(sessionStart) + zoom[1] * durationSecs * 1000).toISOString();
  }, [sessionStart, sessionEnd, zoom, durationSecs]);

  // Track which signals the dock currently has wired up. The dock persists
  // its widget layout in localStorage under 'nfr-dock-layout-v2'; we read it
  // the same way the website does.
  const [signalIds, setSignalIds] = useState<number[]>([]);
  const lastIdsRef = useRef<string>('');
  useEffect(() => {
    const tick = () => {
      try {
        const raw = localStorage.getItem('nfr-dock-layout-v2');
        if (!raw) { setSignalIds([]); lastIdsRef.current = ''; return; }
        const widgets = JSON.parse(raw);
        const ids = new Set<number>();
        for (const w of widgets ?? []) {
          for (const sig of w.signals ?? []) {
            if (typeof sig === 'number') ids.add(sig);
          }
        }
        const sorted = [...ids].sort((a, b) => a - b);
        const key = sorted.join(',');
        if (key !== lastIdsRef.current) {
          lastIdsRef.current = key;
          setSignalIds(sorted);
        }
      } catch { /* ignore */ }
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, []);

  const { store, status } = useReplayFrames({
    sessionId: id ?? null,
    signalIds,
    start: visStart,
    end: visEnd,
  });

  const { ids: availableSignalIds, status: idsStatus } = useSessionSignalIds(id ?? null);

  if (detailErr) {
    return <div className="p-6 font-mono text-xs text-red-400">ERROR: {detailErr}</div>;
  }
  if (!detail) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }

  return (
    <SignalsProvider>
      <div className="h-full flex flex-col">
        <DockDirection
          t={t}
          onT={setT}
          mode="replay"
          onMode={(m) => { if (m === 'live') navigate('/'); }}
          durationSecs={durationSecs}
          density="compact"
          graphStyle="line"
          frames={store}
          exportHref={id ? `/api/sessions/${id}/export.csv` : null}
          navigate={navigate}
          sessionSlot={<SessionPicker />}
          availableSignalIds={idsStatus === 'ready' ? availableSignalIds : null}
          onZoom={(z) => setZoom(z)}
        />
      </div>
    </SignalsProvider>
  );
}
```

Note: `<DockDirection>` already supports `availableSignalIds` (added in the website rework — see `packages/widgets/src/dock/dir-dock.tsx`). The `onZoom` prop is **new** — see Task 11 to add it to `DockDirection`.

- [ ] **Step 3: Delete the dead overview hook**

```
rm app/src/hooks/useOverview.ts
```

Also remove any imports of `useOverview` elsewhere (use Grep to confirm: `grep -rn "useOverview" app/src` → should be empty after Step 2's rewrite).

- [ ] **Step 4: Build + test**

```
cd app && npx tsc --noEmit && npx vitest run
```

Expected: type-clean (modulo the new `onZoom` prop being undeclared on `DockDirection` — that's expected until Task 11), all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/Replay.tsx
git rm app/src/hooks/useOverview.ts
git commit -m "app/replay: lazy per-signal fetch on visible window; drop bulk overview"
```

---

## Task 11: Plumb `onZoom` through `DockDirection`

**Files:**
- Modify: `packages/widgets/src/dock/dir-dock.tsx`

The dock currently absorbs `onZoom` callbacks per widget into its `widget.zoom` state via `patch()`. To let `Replay.tsx` react to the **dock-level** "most-recent zoom," surface a new optional prop.

- [ ] **Step 1: Add prop to `DockDirectionProps`**

In the interface declaration (~line 67), add:

```ts
  /** Notified when any widget's zoom range changes. Use to drive a global
   *  visible-window fetch. `null` = the widget reset its zoom. */
  onZoom?: (z: [number, number] | null) => void;
```

- [ ] **Step 2: Destructure it and call from the existing graph-config patch**

In `DockDirection({ ... }: DockDirectionProps)` add `onZoom` to the destructured args (default `undefined`).

Find the `onZoom={(z) => onChange({ ...widget, zoom: z })}` site on the `<GraphWidget>` render (~line 1196). Replace with:

```tsx
onZoom={(z) => {
  onChange({ ...widget, zoom: z });
  onZoom?.(z);
}}
```

Do the same for the `<CellVoltagesWidget>` render (~line 1202) since it also forwards a zoom.

- [ ] **Step 3: Build + test**

```
cd packages/widgets && npx vitest run
```

Expected: PASS — existing tests untouched, no new tests needed for this thin pass-through.

- [ ] **Step 4: Commit**

```bash
git add packages/widgets/src/dock/dir-dock.tsx
git commit -m "widgets/dock: forward zoom changes via new onZoom prop"
```

---

## Task 12: Min/max band in `GraphWidget`

**Files:**
- Modify: `packages/widgets/src/widgets/widgets.tsx`

- [ ] **Step 1: Add `showRange` prop**

In `GraphWidgetProps` (around line 15), append:

```ts
  /** Show a translucent band between vMin and vMax behind each trace.
   *  Useful for spike-debugging at coarse zoom. Default true. */
  showRange?: boolean;
```

Destructure it with `showRange = true` in the component signature.

- [ ] **Step 2: Carry min/max through the per-signal series**

Find the `series` builder (~line 100). It currently extracts `r.value` from each frame. Extend it to also pull `vMin`/`vMax`. Replace the relevant block with:

```ts
  const series = signals.map((sid) => {
    const sig = catalog.resolve(sid);
    if (!sig) return null;
    const all = frames?.series(sig.id) ?? [];
    if (all.length === 0) return { sig, data: new Array(N).fill(0), vMin: null, vMax: null, empty: true };

    const len = all.length;
    const winLen = Math.max(8, Math.floor(len * win));
    let start: number, end: number;
    if (zoom && zoom.length === 2) {
      start = Math.max(0, Math.floor(zoom[0] * len));
      end = Math.max(start + 1, Math.min(len, Math.ceil(zoom[1] * len)));
    } else if (mode === 'live') {
      end = len;
      start = Math.max(0, len - winLen);
    } else {
      start = 0;
      end = len;
    }
    const slicedFrames = all.slice(start, end);
    if (slicedFrames.length === 0) return { sig, data: new Array(N).fill(0), vMin: null, vMax: null, empty: true };

    const valueRaw = slicedFrames.map((f) => f.value);
    const data = resampleToN(valueRaw, N);

    // vMin/vMax tracks only if at least one frame had non-undefined values
    // and at least one bucket has a span (sample_n > 1 ⇒ min !== max). The
    // simplest "any frame has vMin?" check is good enough.
    const hasRange = slicedFrames.some((f) => f.vMin !== undefined && f.vMax !== undefined && f.vMin !== f.vMax);
    let vMin: number[] | null = null;
    let vMax: number[] | null = null;
    if (showRange && hasRange) {
      const minRaw = slicedFrames.map((f) => (f.vMin ?? f.value));
      const maxRaw = slicedFrames.map((f) => (f.vMax ?? f.value));
      vMin = resampleToN(minRaw, N);
      vMax = resampleToN(maxRaw, N);
    }
    return { sig, data, vMin, vMax };
  }).filter(Boolean) as { sig: Signal; data: number[]; vMin: number[] | null; vMax: number[] | null; empty?: boolean }[];
```

- [ ] **Step 3: Add the band path renderer**

In the Series render (~line 354), insert before the existing `<path d={pathFor(...)}>` line:

```tsx
              {s.vMin && s.vMax && (
                <path
                  d={bandPathFor(s.vMin, s.vMax)}
                  fill={color}
                  fillOpacity={0.18}
                  stroke="none"
                />
              )}
```

Add the helper alongside `pathFor` / `areaPathFor` (~line 200):

```ts
  const bandPathFor = (lo: number[], hi: number[]) => {
    // Forward along hi, back along lo (closed polygon).
    let d = `M ${x(0)} ${y(hi[0])}`;
    for (let i = 1; i < hi.length; i++) d += ` L ${x(i)} ${y(hi[i])}`;
    for (let i = lo.length - 1; i >= 0; i--) d += ` L ${x(i)} ${y(lo[i])}`;
    d += ' Z';
    return d;
  };
```

Note: `vMin`/`vMax` arrays may have undefined entries if `resampleToN` returned them; if you see test failures or NaN values in the SVG, guard with `Number.isFinite` and skip the band for that signal.

- [ ] **Step 4: Expand domain to include min/max**

Today domain is computed from `s.data`. For the band not to clip, expand to include the min/max arrays. In the domain block (~line 136), inside the `for (const s of series)` loop, after the `isDefaultRange` branch's `for (const v of s.data)`, also iterate over `s.vMin` and `s.vMax` if present:

```ts
        if (s.vMin) for (const v of s.vMin) { if (v < lo) lo = v; if (v > hi) hi = v; }
        if (s.vMax) for (const v of s.vMax) { if (v < lo) lo = v; if (v > hi) hi = v; }
```

- [ ] **Step 5: Add a widget config toggle in the inspector**

Find the per-widget inspector in `packages/widgets/src/dock/dir-dock.tsx` (~line 714 — the `if (w.type === 'graph')` block with the `ZOOM` / `Y AXIS` controls). Add a new row:

```tsx
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, letterSpacing: 1.2 }}>
                        <span>MIN/MAX BAND</span>
                        <span style={{ color: w.showRange === false ? SH_COLORS.textFaint : SH_COLORS.accentBright }}>
                          {w.showRange === false ? 'OFF' : 'ON'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <SegBtn active={w.showRange !== false} onClick={() => patch(w.id, { showRange: true })}>ON</SegBtn>
                        <SegBtn active={w.showRange === false} onClick={() => patch(w.id, { showRange: false })}>OFF</SegBtn>
                      </div>
                    </div>
```

And in the `<GraphWidget>` render call (~line 1196) pass it through:

```tsx
showRange={widget.showRange}
```

Same for `<CellVoltagesWidget>` if it accepts `showRange` after Step 1's type change — if not, leave it; the cell-voltages graph is fine without bands for v1.

- [ ] **Step 6: Tests**

Add a widget test in `packages/widgets/src/widgets/widgets.test.ts` (create if missing):

```ts
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { GraphWidget } from './widgets';
import { FramesContext, SignalsContext } from '../data/contexts';
// You'll need a minimal FramesStore + SignalCatalog stub. Look at
// graph-hover-sync.test.tsx for an existing pattern.

describe('GraphWidget min/max band', () => {
  // Skeleton — flesh out using the existing graph test as the template.
  it('renders a band path when frames carry vMin/vMax with a spread', () => {
    // ...mount with a fake frames store that returns rows with vMin < vMax.
    // assert that document.querySelectorAll('path[fill-opacity="0.18"]').length >= 1.
  });

  it('omits the band when every frame has vMin === vMax (deep zoom)', () => {
    // ...mount with frames where vMin === vMax (or undefined).
    // assert that no band path with fill-opacity="0.18" is rendered.
  });
});
```

If creating that file is non-trivial because the GraphWidget needs many context providers, the **acceptable alternative** is one unit test on `bandPathFor` extracted as a top-level export, plus a manual smoke check in Task 13.

- [ ] **Step 7: Build + test**

```
cd packages/widgets && npx vitest run
```

Expected: PASS — existing tests untouched + any new ones added.

- [ ] **Step 8: Commit**

```bash
git add packages/widgets/src/widgets/widgets.tsx packages/widgets/src/dock/dir-dock.tsx packages/widgets/src/widgets/widgets.test.ts
git commit -m "widgets: render min/max band on GraphWidget; per-widget showRange toggle"
```

---

## Task 13: Manual smoke + regression sweep

- [ ] **Step 1: Full test sweep**

```
cd packages/widgets && npx vitest run
cd app             && npx vitest run
cd desktop/main    && npx vitest run
```

Expected: all suites pass.

- [ ] **Step 2: Production typecheck**

```
cd app          && npx tsc --noEmit
cd desktop/main && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Manual smoke in the Electron app**

Launch the desktop dev environment (whatever your dev command is — likely `npm run dev` inside `desktop/`). With a session that has known BSPD-relevant signals:

1. Open a replay session.
2. Drag a brake-pressure or current signal onto a graph. Confirm it draws within ~1 s and shows ~one point per pixel across the full session.
3. Confirm the min/max band is visible behind the line at coarse zoom.
4. Drag-to-zoom on a 5-second region. Within ~1 s the graph repopulates at higher resolution; the band visibly narrows (less per-bucket spread).
5. Zoom further until the band collapses onto the line — that's the deep-zoom regime where each bucket has ≤1 sample. You're looking at the actual raw recorded values.
6. Double-click to reset zoom: should be instant (cache hit).
7. Toggle a signal off and back on: should be instant (cache hit).
8. Hover on a graph: cross-graph hover sync still works (regression check from the previous project).
9. Toggle `MIN/MAX BAND` to OFF in the inspector: band disappears; line stays.

- [ ] **Step 4: Commit any test/typecheck fixups**

```bash
git add -A
git commit -m "tests: follow-ups from regression sweep"
```

(Only if needed.)

---

## Self-Review Notes

- **Spec coverage:**
  - Layer 1: unchanged (catalog).
  - Layer 2 RPC + route + hook → Task 1, 3, 8.
  - Layer 3 RPC widening + helper + route + hook + store → Task 1, 2, 3, 9.
  - Retire `get_session_overview` → Task 1, 2, 3, 10.
  - Min/max band → Task 12.
  - Zoom plumbing → Task 11.
  - Cache → Task 6, 7, 9.
- **Out-of-scope** items in the spec are not introduced anywhere in this plan.
- **No placeholders.** Every step has concrete code or a concrete command.
- **Type consistency:** `SignalWindowRow` shape matches the SQL return columns. `FrameRow.vMin`/`vMax` are already optional on the shared type; the new store populates them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-desktop-replay-lazy-fetch.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review between.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
