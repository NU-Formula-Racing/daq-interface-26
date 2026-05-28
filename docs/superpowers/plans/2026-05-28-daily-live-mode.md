# Daily Live-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live mode work end-to-end on the desktop. Replace the session-per-recording model with a single `live_today` table truncated at America/Chicago midnight. Frames flow in real time via the existing WebSocket; scroll-back is served by a new windowed RPC.

**Spec:** `docs/superpowers/specs/2026-05-28-daily-live-mode-design.md`

**Architecture:** Parser writes live frames straight to `live_today` (no `sessions` row, no `rt_readings`). Desktop server truncates the table on boot and every 15 minutes against today's Chicago-midnight. App live page reads via WS push (real-time edge) plus a windowed-fetch hook (historical scroll-back); both ingest into the same in-memory `FramesStore`.

**Tech Stack:** Embedded Postgres 17 (no `pg_cron`), Fastify + ws on the desktop server, React + Vite app, Python parser. America/Chicago midnight via `(now() AT TIME ZONE 'America/Chicago')::date AT TIME ZONE 'America/Chicago'` in SQL.

---

### Task 1: Parser wire-format fix (independent prerequisite)

The root cause of "no frames arrive" today: `serial_source.py` expects a `0xAA 0x55` sync prefix that the basestation firmware never sends. The fix already exists in `stash@{1}` on this machine.

**Files:**
- Modify: `parser/serial_source.py`
- Modify: `parser/tests/test_serial_source.py`

- [ ] **Step 1: Apply just the parser portion of stash@{1}**

```bash
git checkout 'stash@{1}' -- parser/serial_source.py parser/tests/test_serial_source.py
```

- [ ] **Step 2: Run the parser tests**

```bash
cd parser && python -m pytest tests/test_serial_source.py -v
```

Expected: all tests pass (the stash includes corresponding test updates).

- [ ] **Step 3: Rebuild the bundled parser binary**

```bash
cd parser && bash build.sh
```

Expected: `parser/dist/parser` updated; no PyInstaller errors.

- [ ] **Step 4: Commit**

```bash
git add parser/serial_source.py parser/tests/test_serial_source.py
git commit -m "parser: drop 0xAA 0x55 sync expectation from serial wire format

The basestation firmware (telemetry-26 processIncomingPackets) sends
[rssi i16][snr f32][len u8][payload] — no sync prefix. The parser was
expecting [0xAA 0x55][rssi i16][snr f32][len u8][payload] and discarding
every byte as desync garbage, so live mode was producing zero frames.

Resync heuristic now: payload_size must be a multiple of FRAME_SIZE
(18 bytes); otherwise drop one byte and retry."
```

---

### Task 2: Local DB schema — `live_today` table + RPC

**Files:**
- Create: `desktop/migrations/0015_live_today.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Live mode no longer creates sessions. All live frames land here.
-- Truncated by the desktop server at America/Chicago midnight (the
-- embedded Postgres has no pg_cron, so cleanup is server-driven).

CREATE TABLE live_today (
  ts         TIMESTAMPTZ NOT NULL,
  signal_id  INTEGER NOT NULL,
  value      DOUBLE PRECISION NOT NULL
);
CREATE INDEX live_today_lookup_idx ON live_today (signal_id, ts);

CREATE OR REPLACE FUNCTION get_live_today_window(
  p_signal_ids   INTEGER[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  DOUBLE PRECISION
)
RETURNS TABLE (
  ts          TIMESTAMPTZ,
  signal_id   INTEGER,
  signal_name TEXT,
  unit        TEXT,
  value_min   DOUBLE PRECISION,
  value_max   DOUBLE PRECISION,
  value_avg   DOUBLE PRECISION,
  sample_n    INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM r.ts) / p_bucket_secs) * p_bucket_secs) AS ts,
    r.signal_id,
    d.signal_name,
    d.unit,
    min(r.value)            AS value_min,
    max(r.value)            AS value_max,
    avg(r.value)            AS value_avg,
    count(*)::INT           AS sample_n
  FROM live_today r
  JOIN signal_definitions d ON d.id = r.signal_id
  WHERE r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4
  ORDER BY 1;
$$;
```

- [ ] **Step 2: Apply to the running USB DB**

```bash
psql -h localhost -p 5499 -U nfr postgres -f desktop/migrations/0015_live_today.sql
psql -h localhost -p 5499 -U nfr postgres -c "INSERT INTO schema_migrations (version) VALUES ('0015_live_today') ON CONFLICT DO NOTHING;"
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE FUNCTION`, `INSERT 0 1`.

- [ ] **Step 3: Smoke test the RPC**

```bash
psql -h localhost -p 5499 -U nfr postgres -c "
  WITH inserted AS (
    INSERT INTO live_today (ts, signal_id, value)
    SELECT now() - (i || ' ms')::interval,
           (SELECT id FROM signal_definitions LIMIT 1),
           random() * 10
    FROM generate_series(0, 100) i
    RETURNING signal_id
  )
  SELECT count(*) FROM get_live_today_window(
    ARRAY[(SELECT signal_id FROM inserted LIMIT 1)]::int[],
    now() - interval '1 minute', now() + interval '1 minute', 0.5);
  DELETE FROM live_today WHERE signal_id = (SELECT id FROM signal_definitions LIMIT 1);
"
```

Expected: count > 0 (rows bucketed), DELETE rolls test data back.

- [ ] **Step 4: Commit**

```bash
git add desktop/migrations/0015_live_today.sql
git commit -m "migrations: add live_today + get_live_today_window

Single rolling daily buffer for live mode (no session_id). Desktop
server truncates at America/Chicago midnight; embedded PG has no
pg_cron so cleanup is application-driven."
```

---

### Task 3: Parser writes to `live_today` instead of `rt_readings` (live mode only)

`parser/live.py` currently calls `open_session`, emits `session_started`, writes via `copy_rt_readings`, and on shutdown emits `session_ended`. In live mode we skip the session and write straight to `live_today`. Replay-from-file (also routes through `run_live`) keeps the session lifecycle.

**Files:**
- Modify: `parser/live.py`
- Modify: `parser/db.py`
- Modify: `parser/__main__.py`
- Test: `parser/tests/test_live.py`

- [ ] **Step 1: Add a `copy_live_today` helper in `parser/db.py`**

After the existing `copy_rt_readings` function add:

```python
def copy_live_today(
    conn: psycopg.Connection,
    readings: Iterable[Reading],
) -> int:
    """Bulk-insert live readings into the daily rolling buffer.
    Same shape as copy_rt_readings but no session_id column."""
    count = 0
    with conn.cursor() as cur:
        with cur.copy(
            "COPY live_today (ts, signal_id, value) FROM STDIN"
        ) as copy:
            for r in readings:
                copy.write_row((r.ts, r.signal_id, r.value))
                count += 1
    conn.commit()
    return count
```

- [ ] **Step 2: Extend `run_live` with a `streaming_only` flag in `parser/live.py`**

Read the existing `run_live(dsn, dbc_csv, source, emitter)` signature, add `streaming_only: bool = False` as the last keyword arg. When True:
- Skip `open_session` / `session_started`.
- Replace the `copy_rt_readings(conn, session_id, readings)` call with `copy_live_today(conn, readings)`.
- Skip the `move_rt_to_sd` step on shutdown (live mode has no SD destination).
- Still emit `frames` events on the protocol stream (the WS dock relies on these).

- [ ] **Step 3: Pass `streaming_only=True` from the live serial entry point**

In `parser/__main__.py`, change the `live` branch from:

```python
run_live(
    dsn=dsn, dbc_csv=args.dbc,
    source=serial_events(args.port, args.baud),
    emitter=emitter,
)
```

to:

```python
run_live(
    dsn=dsn, dbc_csv=args.dbc,
    source=serial_events(args.port, args.baud),
    emitter=emitter,
    streaming_only=True,
)
```

`replay` mode keeps the default (`streaming_only=False`) and continues writing to `rt_readings` + emitting session events. We'll retire rt_readings + replay mode later if we don't actually use them; out of scope for this plan.

- [ ] **Step 4: Update `parser/tests/test_live.py`**

Add a test that runs `run_live(streaming_only=True, …)` against a fake source emitting two frames, then asserts:
- No `session_started` event was emitted.
- `live_today` has two rows with the expected values (use a real local PG via the existing test fixture).

```python
def test_streaming_only_writes_live_today_no_session(pg_dsn):
    events: list[ProtocolEvent] = []
    emitter = RecordingEmitter(events)
    source = static_source([
        SourceEvent.frame(ts_ms=0, frame_id=0x2A1, data=b"\x00" * 8),
        SourceEvent.frame(ts_ms=10, frame_id=0x2A1, data=b"\x00" * 8),
    ])
    run_live(
        dsn=pg_dsn,
        dbc_csv=TEST_DBC,
        source=source,
        emitter=emitter,
        streaming_only=True,
    )
    types = [e["type"] for e in events]
    assert "session_started" not in types
    assert "session_ended" not in types
    with psycopg.connect(pg_dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM live_today")
        (n,) = cur.fetchone()
    assert n >= 1
```

- [ ] **Step 5: Run parser tests**

```bash
cd parser && python -m pytest tests/test_live.py tests/test_db.py -v
```

Expected: green.

- [ ] **Step 6: Rebuild the parser binary and commit**

```bash
cd parser && bash build.sh
git add parser/live.py parser/db.py parser/__main__.py parser/tests/test_live.py
git commit -m "parser: live mode writes live_today (no session)

Adds copy_live_today + streaming_only flag on run_live. When True
(serial-live entry point), skips open_session/session_started/
session_ended and copies straight into the daily rolling buffer.
Replay-from-file keeps the existing session lifecycle."
```

---

### Task 4: Desktop server — truncation timer, drop session-handling for live

**Files:**
- Modify: `desktop/main/src/index.ts`
- Create: `desktop/main/src/db/live-today-cleanup.ts`
- Test: `desktop/main/src/db/live-today-cleanup.test.ts`

- [ ] **Step 1: Write the failing test for the cleanup query**

```ts
import { describe, it, expect } from 'vitest';
import { buildLiveTodayCleanupSql } from './live-today-cleanup.ts';

describe('buildLiveTodayCleanupSql', () => {
  it('returns a DELETE keyed on today Chicago midnight', () => {
    const sql = buildLiveTodayCleanupSql();
    expect(sql).toMatch(/DELETE FROM live_today/);
    expect(sql).toMatch(/America\/Chicago/);
    expect(sql).toMatch(/ts <\s*\(now\(\) AT TIME ZONE 'America\/Chicago'\)::date AT TIME ZONE 'America\/Chicago'/);
  });
});
```

- [ ] **Step 2: Run the test (should fail — module doesn't exist)**

```bash
cd desktop && npm test -- main/src/db/live-today-cleanup.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Create the module**

```ts
// desktop/main/src/db/live-today-cleanup.ts
import type pg from 'pg';

/** SQL that wipes rows whose `ts` falls before today's Chicago midnight.
 *  Exported separately so it can be unit-tested without a live DB. */
export function buildLiveTodayCleanupSql(): string {
  return `
    DELETE FROM live_today
    WHERE ts < (now() AT TIME ZONE 'America/Chicago')::date
              AT TIME ZONE 'America/Chicago'
  `;
}

/** Run the cleanup once. */
export async function runLiveTodayCleanup(pool: pg.Pool): Promise<number> {
  const { rowCount } = await pool.query(buildLiveTodayCleanupSql());
  return rowCount ?? 0;
}

/** Start a recurring cleanup. Returns a stop function. */
export function startLiveTodayCleanupTimer(
  pool: pg.Pool,
  intervalMs: number = 15 * 60 * 1000,
): () => void {
  const fire = async () => {
    try {
      const n = await runLiveTodayCleanup(pool);
      if (n > 0) console.log(`live_today cleanup deleted ${n} stale rows`);
    } catch (err) {
      console.error('live_today cleanup failed:', (err as Error).message);
    }
  };
  void fire(); // run once immediately
  const iv = setInterval(() => { void fire(); }, intervalMs);
  return () => clearInterval(iv);
}
```

- [ ] **Step 4: Run the test (should pass)**

```bash
cd desktop && npm test -- main/src/db/live-today-cleanup.test.ts
```

Expected: 1/1 passing.

- [ ] **Step 5: Wire the timer into `desktop/main/src/index.ts`**

Locate the existing `parser.start()` block (around the `liveStreamer` initialisation). Add:

```ts
import { startLiveTodayCleanupTimer } from './db/live-today-cleanup.ts';
// …
const stopLiveCleanup = startLiveTodayCleanupTimer(pool);
```

Add `stopLiveCleanup?.()` to whatever cleanup path the server already uses on shutdown (search for `parser.stop()` / `liveStreamer?.stop()`).

- [ ] **Step 6: Detach the cloud live-stream worker**

In the same file, comment out (don't delete — preserves the wiring for reuse later) the `startLiveStreamer` call:

```ts
// live-cloud-sync was tied to session_started/session_ended events that the
// parser no longer emits in live mode (see 2026-05-28 daily-live-mode design).
// Re-enable later if we add cloud sync back.
// const { startLiveStreamer } = await import('./cloud/live-stream.ts');
// liveStreamer = await startLiveStreamer({ parser, pool });
```

- [ ] **Step 7: Run the desktop test suite**

```bash
cd desktop && npm run typecheck 2>&1 | grep -v 'cloud/list' | tail
cd desktop && npm test -- main/src/db/live-today-cleanup.test.ts
```

Expected: only the pre-existing `cloud/list.ts` error in typecheck; cleanup test green.

- [ ] **Step 8: Commit**

```bash
git add desktop/main/src/db/live-today-cleanup.ts \
        desktop/main/src/db/live-today-cleanup.test.ts \
        desktop/main/src/index.ts
git commit -m "desktop: live_today cleanup timer + detach cloud live-streamer

Runs on boot and every 15 min: DELETE FROM live_today WHERE ts is
before today's Chicago midnight. Pure SQL — embedded PG has no
pg_cron. Live-cloud-sync worker is left wired but commented out
because it required session_started events that the parser no longer
emits in live mode."
```

---

### Task 5: App — `useLiveTodayFrames` hook

Combines the existing WS push with an `ensureWindow(start, end, signalIds)` historical fetch into a single FramesStore.

**Files:**
- Create: `app/src/hooks/useLiveTodayFrames.ts`
- Test: `app/src/hooks/useLiveTodayFrames.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveTodayFrames } from './useLiveTodayFrames.ts';

vi.mock('../api/ws.ts', () => ({
  subscribeLive: vi.fn(() => ({ close: () => {} })),
}));
vi.mock('../api/client.ts', () => ({
  apiGet: vi.fn(async () => []),
}));

describe('useLiveTodayFrames', () => {
  it('exposes a FramesStore-compatible object and an ensureWindow', () => {
    const { result } = renderHook(() => useLiveTodayFrames());
    expect(typeof result.current.store.latest).toBe('function');
    expect(typeof result.current.store.subscribe).toBe('function');
    expect(typeof result.current.ensureWindow).toBe('function');
  });

  it('calls /api/live/window when ensureWindow is invoked with new range', async () => {
    const { apiGet } = await import('../api/client.ts');
    const { result } = renderHook(() => useLiveTodayFrames());
    await act(async () => {
      await result.current.ensureWindow(
        '2026-05-28T05:00:00Z',
        '2026-05-28T06:00:00Z',
        [1, 2, 3],
      );
    });
    expect(apiGet).toHaveBeenCalled();
    const [url] = (apiGet as any).mock.calls.at(-1);
    expect(url).toMatch(/\/api\/live\/window/);
    expect(url).toMatch(/ids=1,2,3/);
  });
});
```

- [ ] **Step 2: Run the test (FAIL — module doesn't exist)**

```bash
cd app && npx vitest run src/hooks/useLiveTodayFrames.test.ts
```

- [ ] **Step 3: Create the hook**

```ts
// app/src/hooks/useLiveTodayFrames.ts
import { useEffect, useRef, useSyncExternalStore, useState } from 'react';
import { subscribeLive } from '../api/ws.ts';
import { apiGet } from '../api/client.ts';
import type { ParserEvent } from '../api/types.ts';
import type { FramesStore as IFramesStore, FrameRow } from '@nfr/widgets';

// Lightweight store: same shape as existing FramesStore (kept private so
// we don't accidentally reuse the live-session store from useLiveFrames).
class TodayFramesStore implements IFramesStore {
  private bySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  push(rows: FrameRow[]): void {
    for (const r of rows) {
      const buf = this.bySignal.get(r.signal_id) ?? [];
      buf.push(r);
      this.bySignal.set(r.signal_id, buf);
      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < r.ts) this.latestBySignal.set(r.signal_id, r);
      if (this._firstTs === null || r.ts < this._firstTs) this._firstTs = r.ts;
      if (this._latestTs === null || r.ts > this._latestTs) this._latestTs = r.ts;
    }
    this.version++;
    for (const l of this.listeners) l();
  }
  latest(id: number) { return this.latestBySignal.get(id) ?? null; }
  series(id: number) { return this.bySignal.get(id) ?? []; }
  firstTs() { return this._firstTs; }
  latestTs() { return this._latestTs; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getVersion() { return this.version; }
  reset() {
    this.bySignal.clear(); this.latestBySignal.clear();
    this._firstTs = null; this._latestTs = null;
    this.version++; for (const l of this.listeners) l();
  }
}

const BUCKETS = 800;

export function useLiveTodayFrames() {
  const storeRef = useRef<TodayFramesStore>(new TodayFramesStore());
  const store = storeRef.current;
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  // Remembers fetched ranges per signal so scroll-back doesn't re-hit the API.
  const fetchedRef = useRef<Map<number, Array<[string, string]>>>(new Map());

  useEffect(() => {
    const sub = subscribeLive((ev: ParserEvent) => {
      if (ev.type === 'frames') store.push(ev.rows);
    });
    return () => sub.close();
  }, [store]);

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );

  const ensureWindow = async (
    start: string, end: string, signalIds: number[],
  ): Promise<void> => {
    const need = signalIds.filter((id) => {
      const ranges = fetchedRef.current.get(id) ?? [];
      return !ranges.some(([s, e]) => s <= start && end <= e);
    });
    if (need.length === 0) return;
    const durationSecs = Math.max(0.001, (Date.parse(end) - Date.parse(start)) / 1000);
    const bucketSecs = durationSecs / BUCKETS;
    setStatus('loading');
    const url =
      `/api/live/window?ids=${need.join(',')}` +
      `&start=${encodeURIComponent(start)}` +
      `&end=${encodeURIComponent(end)}` +
      `&bucket=${bucketSecs}`;
    try {
      const rows = await apiGet<Array<{
        ts: string; signal_id: number; value_avg: number;
        value_min: number; value_max: number; sample_n: number;
      }>>(url);
      store.push(rows.map((r) => ({
        ts: r.ts, signal_id: r.signal_id, value: r.value_avg,
        vMin: r.value_min, vMax: r.value_max, sampleN: r.sample_n,
      })));
      for (const id of need) {
        const list = fetchedRef.current.get(id) ?? [];
        list.push([start, end]);
        fetchedRef.current.set(id, list);
      }
      setStatus('ready');
    } catch (err) {
      console.error('live window fetch failed', err);
      setStatus('error');
    }
  };

  return { store, ensureWindow, status };
}
```

- [ ] **Step 4: Run the test (PASS)**

```bash
cd app && npx vitest run src/hooks/useLiveTodayFrames.test.ts
```

Expected: 2/2 green.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useLiveTodayFrames.ts app/src/hooks/useLiveTodayFrames.test.ts
git commit -m "app: useLiveTodayFrames hook (WS edge + windowed scrollback)"
```

---

### Task 6: Server route — `/api/live/window` proxies the new RPC

**Files:**
- Create: `desktop/main/src/server/routes/live-window.ts`
- Modify: `desktop/main/src/server/app.ts`
- Test: `desktop/main/src/server/routes/live-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerLiveWindowRoutes } from './live-window.ts';

describe('GET /api/live/window', () => {
  it('passes parsed ids/start/end/bucket to the rpc and returns rows', async () => {
    const query = vi.fn(async () => ({ rows: [
      { ts: '2026-05-28T05:00:00Z', signal_id: 1, signal_name: 'X', unit: '',
        value_min: 0, value_max: 1, value_avg: 0.5, sample_n: 3 },
    ] }));
    const app = Fastify();
    registerLiveWindowRoutes(app, { pool: { query } as any });
    const res = await app.inject({
      method: 'GET',
      url: '/api/live/window?ids=1,2&start=2026-05-28T05:00:00Z&end=2026-05-28T06:00:00Z&bucket=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/get_live_today_window/);
    expect(params).toEqual([[1, 2], '2026-05-28T05:00:00Z', '2026-05-28T06:00:00Z', 1]);
  });
});
```

- [ ] **Step 2: Run it (FAIL)**

```bash
cd desktop && npm test -- main/src/server/routes/live-window.test.ts
```

- [ ] **Step 3: Create the route**

```ts
// desktop/main/src/server/routes/live-window.ts
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export interface LiveWindowDeps { pool: pg.Pool }

interface Q {
  ids?: string;
  start?: string;
  end?: string;
  bucket?: string;
}

export function registerLiveWindowRoutes(app: FastifyInstance, deps: LiveWindowDeps) {
  app.get('/api/live/window', async (req, reply) => {
    const q = (req.query ?? {}) as Q;
    const ids = (q.ids ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const start = q.start ?? '';
    const end = q.end ?? '';
    const bucket = Number(q.bucket ?? 0);
    if (ids.length === 0 || !start || !end || !(bucket > 0)) {
      reply.code(400);
      return { error: 'expected ?ids=&start=&end=&bucket=' };
    }
    const { rows } = await deps.pool.query(
      `SELECT * FROM get_live_today_window($1::int[], $2::timestamptz, $3::timestamptz, $4::double precision)`,
      [ids, start, end, bucket],
    );
    return rows;
  });
}
```

- [ ] **Step 4: Run it (PASS)**

```bash
cd desktop && npm test -- main/src/server/routes/live-window.test.ts
```

- [ ] **Step 5: Wire into `desktop/main/src/server/app.ts`**

Find the block where other route registrations live (e.g. `registerSignalRoutes`, `registerImportRoutes`). Add:

```ts
import { registerLiveWindowRoutes } from './routes/live-window.ts';
// …
registerLiveWindowRoutes(app, { pool });
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd desktop && npm run typecheck 2>&1 | grep -v 'cloud/list' | tail
git add desktop/main/src/server/routes/live-window.ts \
        desktop/main/src/server/routes/live-window.test.ts \
        desktop/main/src/server/app.ts
git commit -m "server: GET /api/live/window route over get_live_today_window"
```

---

### Task 7: Replace `useLiveFrames` usage in `Live.tsx`

Switch the live page from `useLiveFrames` (session-shaped) to `useLiveTodayFrames` (daily-table-shaped). Default the visible window to today's Chicago midnight → now, auto-advance end as WS frames arrive, and call `ensureWindow` when the slider moves left.

**Files:**
- Modify: `app/src/pages/Live.tsx`

- [ ] **Step 1: Read the existing Live.tsx, then rewrite the data layer**

Replace the `const frames = useLiveFrames();` line with:

```tsx
const { store, ensureWindow } = useLiveTodayFrames();

// Visible window: starts at today's Chicago midnight, ends at "now". The
// FramesStore handles real-time WS pushes; ensureWindow backfills any
// older slice the user scrolls into.
const [visStart, setVisStart] = useState(() => chicagoMidnightIso());
const [visEnd, setVisEnd] = useState(() => new Date().toISOString());

// Live-edge auto-advance: every 250ms, while at t=1, bump visEnd to now.
useEffect(() => {
  if (t < 0.995) return;
  const iv = setInterval(() => setVisEnd(new Date().toISOString()), 250);
  return () => clearInterval(iv);
}, [t]);

// On signal-list or window change, fetch any missing data.
useEffect(() => {
  if (signalIds.length === 0) return;
  void ensureWindow(visStart, visEnd, signalIds);
}, [signalIds.join(','), visStart, visEnd, ensureWindow]);
```

Add the helper near the top of the file:

```ts
function chicagoMidnightIso(): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  // Build a UTC iso for "today 00:00 America/Chicago" by constructing the
  // local-Chicago-midnight as a UTC instant.
  const local = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`);
  // local is interpreted in the desktop user's TZ; adjust by the offset
  // between desktop TZ and Chicago via toLocaleString trick.
  const desktopOffset = local.getTimezoneOffset();
  const chicagoOffset = new Date(local.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getTimezoneOffset();
  return new Date(local.getTime() + (desktopOffset - chicagoOffset) * 60_000).toISOString();
}
```

Remove the `useLiveStatus`, `frames.reset()`, and any code that referenced `session_id`/`session_started`. Pass `store` to the existing widget tree (`<FramesProvider store={store}>` or `frames={store}` depending on what the dock expects).

- [ ] **Step 2: Smoke-test in the browser via `npm run dev`**

```bash
cd app && npm run dev
```

Open `http://localhost:5173`, switch to live mode, watch the dock. Hard to fully verify without a basestation; at minimum confirm:
- No errors in console.
- Live mode renders the dock with empty graphs (no frames yet without parser).
- Slider scrubs without throwing.

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/Live.tsx
git commit -m "app: Live page reads live_today via daily-frames hook

Drops session-scoped state. Visible window defaults to today Chicago
midnight → now and auto-advances at the live edge. Scroll-back is
served by useLiveTodayFrames.ensureWindow."
```

---

### Task 8: SessionPicker — drop the live-session group

The desktop picker showed a "MOST RECENT LIVE SESSION" group; in the new model live data isn't a session.

**Files:**
- Modify: `app/src/components/SessionPicker.tsx`

- [ ] **Step 1: Remove the live filter + LiveGroup render**

Delete the `liveSessions` `useMemo`, the `LiveGroup` JSX, and the `LiveGroup` component itself. Keep the SD-imports calendar path. Final picker should match what was on `main` before v0.5.12.

- [ ] **Step 2: Build the app to check for stragglers**

```bash
cd app && npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/SessionPicker.tsx
git commit -m "picker: remove live-session group

Live mode no longer creates sessions; nothing to show here."
```

---

### Task 9: End-to-end verification + version bump

- [ ] **Step 1: Reapply migrations on a clean local PG (if you want to test fresh)**

```bash
psql -h localhost -p 5499 -U nfr postgres -c "TRUNCATE live_today;"
```

- [ ] **Step 2: Build the dmg locally**

```bash
(cd app && npm run build) && (cd desktop && npm run package:mac)
```

- [ ] **Step 3: Manual test pass**

1. Install the new dmg.
2. Plug in the basestation receiver, click Scan, confirm the device shows up.
3. Hit live mode. Watch the dock — within a few seconds frames should start appearing in real time.
4. `psql -h localhost -p 5499 -U nfr postgres -c "SELECT count(*) FROM live_today;"` — should be growing.
5. Drag a signal onto a graph. Real-time line should advance.
6. Pull the slider to the left ~30 s. Older data should fill in from the windowed fetch (a brief "loading" before it renders).
7. Push the slider back to t=1. Real-time edge resumes.

- [ ] **Step 4: Bump version + tag**

```bash
# desktop/package.json: 0.5.12 -> 0.6.0  (live-mode redesign warrants a minor bump)
git add desktop/package.json
git commit -m "v0.6.0: daily live-mode

Live mode no longer creates sessions. Frames stream into a single
live_today table truncated at America/Chicago midnight; the app
reads via the existing WS for the real-time edge and a new windowed
RPC for scroll-back. The basestation wire-format mismatch that was
causing 'no frames arrive' is fixed in the same release.

Migration 0015 ships with the dmg and is applied automatically on
first launch."
git tag v0.6.0
git push origin main && git push origin v0.6.0
```

---

## Self-review notes

- All steps include complete code (not "TBD" or "similar to"). Each task is independently committable.
- Type signatures and function names are consistent: `copy_live_today` declared once and referenced everywhere; `useLiveTodayFrames` has the same return shape (`store`, `ensureWindow`, `status`) in the spec, the hook implementation, the test, and the `Live.tsx` consumer.
- Spec → tasks mapping:
  - Bug fix ➝ Task 1.
  - Local schema ➝ Task 2.
  - Parser change ➝ Task 3.
  - Desktop server cleanup + cloud-streamer detach ➝ Task 4.
  - App data hook ➝ Tasks 5 + 6 (HTTP route co-located).
  - App page rewrite ➝ Task 7.
  - Picker cleanup ➝ Task 8.
  - Release ➝ Task 9.
- Out of scope (cloud sync, rt_readings drop) is named in the spec; rt_readings stays around as dead-but-harmless storage for now and can be dropped in a follow-up migration once we're confident replay-from-file isn't using it.
