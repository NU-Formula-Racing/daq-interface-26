# Frontend Fetching Rework + Calendar Session Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the website (`/` and `/app`) fast on 1–2M-row sessions, fix the active-signals filter so it never hides signals that have data, and replace the flat session dropdown with a calendar date picker + that day's session list.

**Architecture:** Three independent data layers — (1) global signal catalog fetched once, (2) per-session "signal IDs with data" via one cheap RPC, (3) bucketed values fetched per `(signal, window, bucket)` lazily with an LRU cache. A shared `<DateAndSessionPicker />` component is consumed by both routes.

**Tech Stack:** React 19, Vite 7, Supabase JS v2, Vitest, react-day-picker, TypeScript (adapters) + JSX (components).

**Spec:** `docs/superpowers/specs/2026-05-18-fetching-and-session-picker-design.md`

---

## File Structure

**New files:**
- `frontend/interface/src/adapters/useSessionSignalIds.ts` — Layer 2 hook
- `frontend/interface/src/adapters/useSessionSignalIds.test.ts` — Layer 2 hook test
- `frontend/interface/src/components/DateAndSessionPicker.jsx` — extracted shared picker
- `frontend/interface/src/lib/lru.ts` — small generic LRU helper
- `frontend/interface/src/lib/lru.test.ts` — LRU test
- `frontend/interface/src/adapters/framesCache.ts` — `(signal,window,bucket)` LRU keyed cache built on `lru.ts`
- `frontend/interface/src/adapters/framesCache.test.ts` — cache test

**Modified files:**
- `frontend/database/supabase_functions.sql` — add `get_session_signal_ids` RPC
- `frontend/interface/src/adapters/useSupabaseFrames.ts` — use cache, drop refetch on cache hit
- `frontend/interface/src/adapters/useSupabaseFrames.test.ts` — new tests for cache behavior (create file)
- `frontend/interface/src/routes/AppRoute.jsx` — swap flat `<select>` for `<DateAndSessionPicker />`, consume `useSessionSignalIds`, pass to dock so sidebar can filter
- `frontend/interface/src/components/SessionIndicator.jsx` — consume new shared picker
- `frontend/interface/src/context/SessionContext.jsx` — remove `get_session_overview` eager fetch, remove name-intersection bug, populate `sessionSignals` from `useSessionSignalIds`-style call
- `frontend/database/info.md` — document the new RPC

**Out-of-scope for this plan (deferred per spec):** materialized overview, streaming chunks, live-mode changes, CSV download path.

---

## Task 1: Add the `get_session_signal_ids` RPC

**Files:**
- Modify: `frontend/database/supabase_functions.sql` (append)
- Modify: `frontend/database/info.md`

- [ ] **Step 1: Add the SQL**

Append to `frontend/database/supabase_functions.sql`:

```sql
-- get_session_signal_ids: distinct signal IDs that have at least one
-- row in sd_readings for a given session. Index-only scan against
-- (session_id, signal_id, timestamp) — sub-100ms on millions of rows.
-- Used by the active-signals sidebar filter on the frontend.
CREATE OR REPLACE FUNCTION get_session_signal_ids(p_session_id UUID)
RETURNS TABLE (signal_id SMALLINT) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT r.signal_id
  FROM sd_readings r
  WHERE r.session_id = p_session_id
  ORDER BY r.signal_id;
END;
$$ LANGUAGE plpgsql STABLE;
```

- [ ] **Step 2: Document it in info.md**

Under "RPC Functions" in `frontend/database/info.md`, add this line:

```
- `get_session_signal_ids(session_id)` — distinct signal IDs present in a session (powers the active-signals filter)
```

- [ ] **Step 3: Apply the RPC to Supabase**

Run via Supabase MCP `apply_migration` with name `add_get_session_signal_ids` and the SQL from Step 1. Verify in dashboard that the function exists.

- [ ] **Step 4: Smoke-test in SQL editor**

In the Supabase SQL Editor, run against an existing session (pick any UUID from `SELECT id FROM sessions LIMIT 1`):

```sql
SELECT * FROM get_session_signal_ids('<session-uuid>');
```

Expected: rows of small integer IDs in ascending order, completes in <200ms.

- [ ] **Step 5: Commit**

```bash
git add frontend/database/supabase_functions.sql frontend/database/info.md
git commit -m "db: add get_session_signal_ids RPC for active-signals filter"
```

---

## Task 2: Generic LRU helper

**Files:**
- Create: `frontend/interface/src/lib/lru.ts`
- Create: `frontend/interface/src/lib/lru.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/interface/src/lib/lru.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LRU } from './lru';

describe('LRU', () => {
  it('set/get keeps recently used entries', () => {
    const c = new LRU<string, number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBe(1);
    c.set('d', 4);
    expect(c.get('b')).toBeUndefined(); // b was LRU, evicted
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.get('d')).toBe(4);
  });

  it('overwriting an existing key updates recency without evicting others', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.set('a', 11);
    c.set('c', 3); // should evict b, not a
    expect(c.get('a')).toBe(11);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  it('has() does not affect recency', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.has('a');
    c.set('c', 3); // a is older by insertion order (has didn't touch it)
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('clear empties the cache', () => {
    const c = new LRU<string, number>(2);
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd frontend/interface && npx vitest run src/lib/lru.test.ts
```

Expected: FAIL — `Cannot find module './lru'`.

- [ ] **Step 3: Implement LRU**

Create `frontend/interface/src/lib/lru.ts`:

```ts
/**
 * Map-backed LRU. Map preserves insertion order in JS; deleting + re-setting
 * a key moves it to the end (most-recent). On set with cap exceeded we evict
 * the first key (least-recent).
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

  clear(): void { this.map.clear(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd frontend/interface && npx vitest run src/lib/lru.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/interface/src/lib/lru.ts frontend/interface/src/lib/lru.test.ts
git commit -m "lib: generic LRU helper"
```

---

## Task 3: Frames cache keyed by (session, signalIds, window, bucket)

**Files:**
- Create: `frontend/interface/src/adapters/framesCache.ts`
- Create: `frontend/interface/src/adapters/framesCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/interface/src/adapters/framesCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FramesCache, frameCacheKey } from './framesCache';

describe('frameCacheKey', () => {
  it('is stable across signal-id ordering', () => {
    expect(frameCacheKey('s1', [3, 1, 2], 't1', 't2', 5))
      .toBe(frameCacheKey('s1', [1, 2, 3], 't1', 't2', 5));
  });
  it('differs when any field differs', () => {
    const base = frameCacheKey('s1', [1], 't1', 't2', 5);
    expect(base).not.toBe(frameCacheKey('s2', [1], 't1', 't2', 5));
    expect(base).not.toBe(frameCacheKey('s1', [2], 't1', 't2', 5));
    expect(base).not.toBe(frameCacheKey('s1', [1], 't1', 't3', 5));
    expect(base).not.toBe(frameCacheKey('s1', [1], 't1', 't2', 10));
  });
});

describe('FramesCache', () => {
  it('marks signal IDs hit on a key the cache already has', () => {
    const c = new FramesCache(4);
    c.recordFetch('s1', [1, 2], 't1', 't2', 5);
    expect(c.alreadyFetched('s1', [1, 2], 't1', 't2', 5)).toBe(true);
    expect(c.alreadyFetched('s1', [1], 't1', 't2', 5)).toBe(true);
    expect(c.alreadyFetched('s1', [3], 't1', 't2', 5)).toBe(false);
  });

  it('missing returns just the IDs not yet fetched for the window', () => {
    const c = new FramesCache(4);
    c.recordFetch('s1', [1, 2], 't1', 't2', 5);
    expect(c.missing('s1', [1, 2, 3, 4], 't1', 't2', 5)).toEqual([3, 4]);
  });

  it('resetSession drops all entries for a session', () => {
    const c = new FramesCache(4);
    c.recordFetch('s1', [1], 't1', 't2', 5);
    c.recordFetch('s2', [1], 't1', 't2', 5);
    c.resetSession('s1');
    expect(c.alreadyFetched('s1', [1], 't1', 't2', 5)).toBe(false);
    expect(c.alreadyFetched('s2', [1], 't1', 't2', 5)).toBe(true);
  });

  it('LRU evicts oldest entry past cap', () => {
    const c = new FramesCache(2);
    c.recordFetch('s1', [1], 'a', 'b', 5);
    c.recordFetch('s1', [2], 'a', 'b', 5);
    c.recordFetch('s1', [3], 'a', 'b', 5); // evicts the [1] entry
    expect(c.alreadyFetched('s1', [1], 'a', 'b', 5)).toBe(false);
    expect(c.alreadyFetched('s1', [2], 'a', 'b', 5)).toBe(true);
    expect(c.alreadyFetched('s1', [3], 'a', 'b', 5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd frontend/interface && npx vitest run src/adapters/framesCache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement FramesCache**

Create `frontend/interface/src/adapters/framesCache.ts`:

```ts
import { LRU } from '@/lib/lru';

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
 * Tracks which (session, window, bucket, signal-id) combinations we've
 * already fetched. We don't store the rows here — the FramesStore holds
 * those. This is purely a "have we asked for it" set, LRU-bounded.
 *
 * `recordFetch(...)` adds one entry per signal id, so callers can ask
 * `missing(...)` to get only the ids they still need to fetch.
 */
export class FramesCache {
  private byKey: LRU<string, true>;
  // Index keys per session so we can evict everything for a session quickly.
  private bySession = new Map<string, Set<string>>();

  constructor(cap = 256) {
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

  alreadyFetched(
    sessionId: string,
    signalIds: readonly number[],
    start: string,
    end: string,
    bucketSecs: number,
  ): boolean {
    return signalIds.every((id) =>
      this.byKey.has(frameCacheKey(sessionId, [id], start, end, bucketSecs)),
    );
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
    for (const k of set) {
      // LRU lacks an explicit delete; overwrite + drop by recreating cap?
      // Cleaner: we expose a delete on LRU. We added has/get/set/clear only.
      // For now: re-set then immediately overwrite by setting then clearing
      // via a sentinel — but simplest is to add LRU.delete. Do that next.
      this.byKey.set(k, true); // touch so we know about it
    }
    // Actual deletion handled by FramesCache.deleteKeys via LRU.delete added below.
    for (const k of set) this.byKey.delete(k);
    this.bySession.delete(sessionId);
  }
}
```

Note: `resetSession` calls `this.byKey.delete(k)`. Add a `delete` method to `LRU` — open `frontend/interface/src/lib/lru.ts` and add:

```ts
  delete(key: K): boolean { return this.map.delete(key); }
```

- [ ] **Step 4: Run tests**

```
cd frontend/interface && npx vitest run src/adapters/framesCache.test.ts src/lib/lru.test.ts
```

Expected: PASS — all tests across both files.

- [ ] **Step 5: Commit**

```bash
git add frontend/interface/src/lib/lru.ts frontend/interface/src/adapters/framesCache.ts frontend/interface/src/adapters/framesCache.test.ts
git commit -m "adapters: frames cache keyed by (session, signal, window, bucket)"
```

---

## Task 4: `useSessionSignalIds` hook (Layer 2)

**Files:**
- Create: `frontend/interface/src/adapters/useSessionSignalIds.ts`
- Create: `frontend/interface/src/adapters/useSessionSignalIds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/interface/src/adapters/useSessionSignalIds.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSessionSignalIds } from './useSessionSignalIds';

vi.mock('@/lib/supabaseClient', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '@/lib/supabaseClient';
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('useSessionSignalIds', () => {
  beforeEach(() => { rpc.mockReset(); });

  it('returns empty set and idle status when sessionId is null', () => {
    const { result } = renderHook(() => useSessionSignalIds(null));
    expect(result.current.ids.size).toBe(0);
    expect(result.current.status).toBe('idle');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls get_session_signal_ids and exposes the ids as a Set', async () => {
    rpc.mockResolvedValueOnce({ data: [{ signal_id: 1 }, { signal_id: 5 }], error: null });
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(rpc).toHaveBeenCalledWith('get_session_signal_ids', { p_session_id: 'sess-1' });
    expect([...result.current.ids].sort()).toEqual([1, 5]);
  });

  it('exposes error status when RPC fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useSessionSignalIds('sess-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.ids.size).toBe(0);
  });
});
```

If `@testing-library/react` is not yet in dev deps, add it. Check first:

```
cd frontend/interface && node -e "console.log(require('./package.json').devDependencies['@testing-library/react'] || 'missing')"
```

If `missing`, install:

```
cd frontend/interface && npm i -D @testing-library/react @testing-library/dom
```

- [ ] **Step 2: Run test to verify it fails**

```
cd frontend/interface && npx vitest run src/adapters/useSessionSignalIds.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `frontend/interface/src/adapters/useSessionSignalIds.ts`:

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface UseSessionSignalIdsResult {
  ids: Set<number>;
  status: Status;
  error: string | null;
}

/**
 * Layer 2: signal IDs that have at least one row in the given session.
 * One cheap RPC, cached per-session in component state. Caller is
 * responsible for catalog lookups (Layer 1) — this hook returns IDs only.
 */
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
    supabase.rpc('get_session_signal_ids', { p_session_id: sessionId })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) {
          setStatus('error');
          setError(rpcErr.message);
          setIds(new Set());
          return;
        }
        const next = new Set<number>();
        for (const r of (data ?? []) as Array<{ signal_id: number }>) next.add(r.signal_id);
        setIds(next);
        setStatus('ready');
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  return { ids, status, error };
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd frontend/interface && npx vitest run src/adapters/useSessionSignalIds.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/interface/src/adapters/useSessionSignalIds.ts frontend/interface/src/adapters/useSessionSignalIds.test.ts frontend/interface/package.json frontend/interface/package-lock.json
git commit -m "adapters: useSessionSignalIds (layer 2 active-signals filter)"
```

---

## Task 5: Wire `FramesCache` into `useSupabaseFrames`

**Files:**
- Modify: `frontend/interface/src/adapters/useSupabaseFrames.ts`
- Create: `frontend/interface/src/adapters/useSupabaseFrames.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/interface/src/adapters/useSupabaseFrames.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSupabaseFrames } from './useSupabaseFrames';

vi.mock('@/lib/supabaseClient', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '@/lib/supabaseClient';
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

const baseArgs = {
  sessionId: 'sess-1',
  start: '2026-05-01T00:00:00Z',
  end:   '2026-05-01T00:10:00Z',
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
});

describe('useSupabaseFrames', () => {
  it('does not refetch a signal already fetched for the same window+bucket', async () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useSupabaseFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    expect(rpc).toHaveBeenCalledTimes(1);

    // toggle off
    rerender({ ids: [] });
    // toggle on again — should NOT trigger a new RPC
    rerender({ ids: [1] });
    await new Promise((r) => setTimeout(r, 10));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('only fetches newly added signals', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: number[] }) => useSupabaseFrames({ ...baseArgs, signalIds: ids }),
      { initialProps: { ids: [1] } },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender({ ids: [1, 2, 3] });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    // The second call should request only the new IDs (2, 3) — not 1.
    const secondCall = rpc.mock.calls[1];
    expect(secondCall[0]).toBe('get_signals_window');
    expect(new Set(secondCall[1].p_signal_ids)).toEqual(new Set([2, 3]));
  });

  it('resets when sessionId changes', async () => {
    const { rerender } = renderHook(
      ({ sid }: { sid: string }) => useSupabaseFrames({ ...baseArgs, sessionId: sid, signalIds: [1] }),
      { initialProps: { sid: 'sess-1' } },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    rerender({ sid: 'sess-2' });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    const secondCall = rpc.mock.calls[1];
    expect(secondCall[1].p_session_id).toBe('sess-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd frontend/interface && npx vitest run src/adapters/useSupabaseFrames.test.ts
```

Expected: FAIL — test 1 will fail because the current implementation refetches when ids toggle (the `fetched` Set is on the `stateRef` per-window, but session-reset clears it; toggling off then on may already be a no-op — verify and adjust expectations only if behavior differs in practice). The other failures should be on the "only newly added" expectation and the session-change reset.

If test 1 already passes against the existing implementation, that's fine — keep it as a regression guard.

- [ ] **Step 3: Rewrite `useSupabaseFrames.ts` to use `FramesCache`**

Replace the body of `frontend/interface/src/adapters/useSupabaseFrames.ts` with:

```ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { SupabaseFramesStore, type RpcRow } from './SupabaseFramesStore';
import { bucketFor } from './bucketFor';
import { FramesCache } from './framesCache';

export type FetchStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface UseSupabaseFramesArgs {
  sessionId: string | null;
  signalIds: number[];
  start: string | null;
  end: string | null;
  targetBuckets?: number;
}

/**
 * Lazy per-signal replay fetcher.
 *
 *  - At session-open: nothing happens until at least one signal is requested.
 *  - On signalIds change: only the newly-added IDs are fetched.
 *  - Toggling a signal OFF then ON does NOT refetch — the FramesCache
 *    remembers that (session, signal, window, bucket) tuple.
 *  - On session/window change: the FramesStore is reset and previously
 *    cached IDs for that session are dropped.
 */
export function useSupabaseFrames(args: UseSupabaseFramesArgs) {
  const storeRef = useRef<SupabaseFramesStore>(new SupabaseFramesStore());
  const cacheRef = useRef<FramesCache>(new FramesCache(256));
  const store = storeRef.current;
  const cache = cacheRef.current;
  const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });

  // What window the store currently holds.
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
      setStatus({ kind: 'idle' });
      return;
    }

    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);

    const windowChanged =
      stateRef.current.sessionId !== args.sessionId ||
      stateRef.current.start !== args.start ||
      stateRef.current.end !== args.end ||
      stateRef.current.bucketSecs !== bucketSecs;

    if (windowChanged) {
      if (stateRef.current.sessionId) cache.resetSession(stateRef.current.sessionId);
      store.reset();
      stateRef.current = {
        sessionId: args.sessionId,
        start: args.start,
        end: args.end,
        bucketSecs,
      };
    }

    const toFetch = cache.missing(args.sessionId, args.signalIds, args.start, args.end, bucketSecs);
    if (toFetch.length === 0) {
      setStatus({ kind: 'ready' });
      return;
    }

    let cancelled = false;
    setStatus({ kind: 'loading' });
    supabase.rpc('get_signals_window', {
      p_session_id: args.sessionId,
      p_signal_ids: toFetch,
      p_start: args.start,
      p_end: args.end,
      p_bucket_secs: bucketSecs,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('get_signals_window failed', error);
        setStatus({ kind: 'error', message: error.message });
        return;
      }
      store.ingest((data ?? []) as RpcRow[]);
      cache.recordFetch(args.sessionId!, toFetch, args.start!, args.end!, bucketSecs);
      setStatus({ kind: 'ready' });
    });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, args.targetBuckets, store, cache]);

  return { store, status };
}
```

- [ ] **Step 4: Run tests**

```
cd frontend/interface && npx vitest run src/adapters/useSupabaseFrames.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Verify existing tests still pass**

```
cd frontend/interface && npx vitest run
```

Expected: PASS — all suites.

- [ ] **Step 6: Commit**

```bash
git add frontend/interface/src/adapters/useSupabaseFrames.ts frontend/interface/src/adapters/useSupabaseFrames.test.ts
git commit -m "adapters: lazy per-signal fetch with LRU window cache"
```

---

## Task 6: Extract `<DateAndSessionPicker />`

**Files:**
- Create: `frontend/interface/src/components/DateAndSessionPicker.jsx`
- Modify: `frontend/interface/src/components/SessionIndicator.jsx`

- [ ] **Step 1: Create the shared component**

Create `frontend/interface/src/components/DateAndSessionPicker.jsx`:

```jsx
import { useMemo } from "react";
import DatePicker from "@/components/DatePicker";

const inputStyle = {
  background: "var(--hud-bg, #2b2d30)",
  border: "1px solid rgba(255,255,255,0.16)",
  fontFamily: "var(--font-mono, \"JetBrains Mono\", monospace)",
  fontSize: "0.8rem",
  color: "#f0f0f0",
  borderRadius: "4px",
  padding: "4px 8px",
  outline: "none",
};

/**
 * Calendar date picker + dropdown of sessions on that date.
 *
 * Props:
 *  - sessions: SessionListItem[]   all sessions known to the app
 *  - selectedDate: 'YYYY-MM-DD' string
 *  - onSelectedDate(date)
 *  - sessionId: string | null
 *  - onSessionId(id)
 *  - formatSessionLabel(session) → string (optional)
 */
export default function DateAndSessionPicker({
  sessions,
  selectedDate,
  onSelectedDate,
  sessionId,
  onSessionId,
  formatSessionLabel,
}) {
  const dayLabel = (s) => {
    if (formatSessionLabel) return formatSessionLabel(s);
    const t = s.started_at ? new Date(s.started_at).toISOString().slice(11, 19) : "?";
    const dur = s.duration_secs != null ? ` · ${s.duration_secs}s` : "";
    return `${t}${dur}`;
  };

  const sessionsForDate = useMemo(
    () => sessions.filter((s) => s.date === selectedDate),
    [sessions, selectedDate],
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <DatePicker value={selectedDate} onChange={onSelectedDate} />
      <select
        value={sessionId ?? ""}
        onChange={(e) => onSessionId(e.target.value || null)}
        style={inputStyle}
      >
        {sessionsForDate.length === 0 && <option value="">No sessions</option>}
        {sessionsForDate.map((s) => (
          <option key={s.id} value={s.id}>{dayLabel(s)}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Update `SessionIndicator.jsx` to use it**

Open `frontend/interface/src/components/SessionIndicator.jsx`. Replace the body of the replay-controls block (the `<motion.div ref={replayRef} ...>` that currently contains `<DatePicker />` and `<select>`) with the new component. Concretely, replace lines 93–108 (the `<DatePicker />` + `<select>` block) with:

```jsx
        <DateAndSessionPicker
          sessions={availableSessions.map((s) => ({ ...s, date: selectedDate }))}
          selectedDate={selectedDate}
          onSelectedDate={setSelectedDate}
          sessionId={sessionId}
          onSessionId={setSessionId}
          formatSessionLabel={formatSessionLabel}
        />
```

And at the top of the file, replace:

```jsx
import DatePicker from "@/components/DatePicker";
```

with:

```jsx
import DateAndSessionPicker from "@/components/DateAndSessionPicker";
```

(`availableSessions` here is already filtered to `selectedDate` by `fetchSessionsForDate` — the `.map((s) => ({ ...s, date: selectedDate }))` adds the `date` field so the shared component's `sessionsForDate` filter passes them through. This avoids changing the SessionContext shape in this task.)

- [ ] **Step 3: Sanity build**

```
cd frontend/interface && npx vite build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/interface/src/components/DateAndSessionPicker.jsx frontend/interface/src/components/SessionIndicator.jsx
git commit -m "components: shared DateAndSessionPicker, used by SessionIndicator"
```

---

## Task 7: Swap `/app`'s flat session dropdown for `<DateAndSessionPicker />`

**Files:**
- Modify: `frontend/interface/src/routes/AppRoute.jsx`

- [ ] **Step 1: Add date state and use the shared picker**

Open `frontend/interface/src/routes/AppRoute.jsx`. Make these edits:

(a) Add an import:

```jsx
import DateAndSessionPicker from '@/components/DateAndSessionPicker';
```

(b) Replace `useSessionList(50)` with `useSessionList(200)` so multiple days are covered:

```jsx
const { sessions } = useSessionList(200);
```

(c) Below `const session = sessions.find(...) ?? sessions[0] ?? null;` derive a `selectedDate` from the URL (fallback to the current session's date or today):

```jsx
  const urlDate = search.get('date');
  const selectedDate = urlDate
    ?? session?.date
    ?? new Date().toISOString().split('T')[0];

  const setSelectedDate = (date) => setSearch((p) => {
    p.set('date', date);
    // When the user picks a new date, clear the session so the picker
    // auto-selects the first session of that date below.
    p.delete('session');
    return p;
  });
```

(d) Update the auto-select effect so it picks the first session of the **selected date**, not the first session globally:

```jsx
  useEffect(() => {
    if (mode !== 'replay' || sessionId) return;
    const firstForDate = sessions.find((s) => s.date === selectedDate);
    if (firstForDate) {
      setSearch((p) => { p.set('session', firstForDate.id); return p; }, { replace: true });
    }
  }, [mode, sessionId, selectedDate, sessions, setSearch]);
```

(e) Replace the existing `sessionSlot` `<select>` block (lines ~88–106 in the current file) with the shared component:

```jsx
  const sessionSlot = mode === 'replay' ? (
    <DateAndSessionPicker
      sessions={sessions}
      selectedDate={selectedDate}
      onSelectedDate={setSelectedDate}
      sessionId={session?.id ?? null}
      onSessionId={(id) => setSearch((p) => {
        if (id) p.set('session', id); else p.delete('session');
        return p;
      })}
      formatSessionLabel={(s) => `${new Date(s.started_at).toISOString().slice(11,19)} · ${s.duration_secs}s`}
    />
  ) : (
    /* unchanged live status span */
    <span style={{
      padding: '3px 8px',
      fontSize: 10,
      letterSpacing: 1,
      color:
        status.kind === 'error' ? '#e06c6c' :
        status.kind === 'ready' ? '#7ec98f' :
        '#9da0a8',
      border: '1px solid rgba(255,255,255,0.09)',
      fontFamily: '"JetBrains Mono", monospace',
    }}>
      {status.kind === 'error' ? `ERR: ${String(status.message).slice(0, 40)}` : `LIVE · ${status.kind.toUpperCase()}`}
    </span>
  );
```

- [ ] **Step 2: Run the dev server and verify manually**

```
cd frontend/interface && npm run dev
```

Open `http://localhost:5173/app`. Verify:
- The replay session picker shows a date input + session dropdown.
- Picking a different date with sessions auto-selects the first one of that date.
- Picking a date with no sessions shows "No sessions" in the dropdown.

Stop the dev server when done (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/routes/AppRoute.jsx
git commit -m "AppRoute: use DateAndSessionPicker instead of flat session dropdown"
```

---

## Task 8: Use `useSessionSignalIds` in `/app` and pass to the dock

**Files:**
- Modify: `frontend/interface/src/routes/AppRoute.jsx`

- [ ] **Step 1: Investigate dock filter prop**

Search the widgets package for any existing prop on `DockDirection` that filters the picker by a set of allowed signal IDs:

```
grep -n "availableSignalIds\|signalIdsInSession\|allowedSignalIds" packages/widgets/src/dock/dir-dock.tsx
```

If none exists, add one. Open `packages/widgets/src/dock/dir-dock.tsx` and locate the props interface for `DockDirection`. Add (alongside existing props):

```ts
  /** If provided, the signal picker hides signals whose id is not in this set.
   *  When undefined, no filtering (back-compat for desktop). */
  availableSignalIds?: ReadonlySet<number> | null;
```

Wire it into the picker. Find the place in `dir-dock.tsx` where the signal list for the picker UI is derived from the catalog. Add a `.filter((sig) => !availableSignalIds || availableSignalIds.has(sig.id))` to that derivation.

- [ ] **Step 2: Pass it from `AppRoute`**

In `frontend/interface/src/routes/AppRoute.jsx`:

```jsx
import { useSessionSignalIds } from '@/adapters/useSessionSignalIds';
```

Below the existing hooks:

```jsx
  const { ids: sessionSignalIds, status: idsStatus } = useSessionSignalIds(
    mode === 'replay' ? (session?.id ?? null) : null,
  );
```

Then on the `<DockDirection ... />` element, add:

```jsx
  availableSignalIds={mode === 'replay' && idsStatus === 'ready' ? sessionSignalIds : null}
```

- [ ] **Step 3: Manual verification**

```
cd frontend/interface && npm run dev
```

Open `/app`, switch to replay, pick a session. Open the signal picker in the dock. Confirm only signals present in the selected session appear. Toggle one on — graph populates. Re-toggle off then on — no network request (check DevTools Network tab; nothing to `get_signals_window`).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/interface/src/routes/AppRoute.jsx packages/widgets/src/dock/dir-dock.tsx
git commit -m "AppRoute: filter sidebar signals to those present in the session"
```

---

## Task 9: Remove the bug in `SessionContext.loadReplaySessionData`

**Files:**
- Modify: `frontend/interface/src/context/SessionContext.jsx`

- [ ] **Step 1: Replace the buggy intersection with the cheap RPC**

Open `frontend/interface/src/context/SessionContext.jsx`. Replace the entire `loadReplaySessionData` callback (lines ~222–267) with:

```jsx
  /** Load session metadata for replay. Values themselves are fetched lazily by
   *  consumers; here we only populate `sessionSignals` so the active-signals
   *  filter in the sidebar is correct. No bulk row fetch. */
  const loadReplaySessionData = useCallback(async (sid) => {
    if (sid == null) {
      setReplaySessionData([]);
      setSessionSignals([]);
      return;
    }
    setIsLoading(true);
    try {
      // No bulk row fetch — Home consumes the FramesStore lazily.
      setReplaySessionData([]);

      const { data: idRows, error: idsErr } = await supabase.rpc(
        'get_session_signal_ids',
        { p_session_id: sid },
      );
      if (idsErr) {
        console.error('get_session_signal_ids failed', idsErr);
        setSessionSignals([]);
        return;
      }
      const idSet = new Set((idRows ?? []).map((r) => r.signal_id));

      // Hydrate names/units from the cached catalog so consumers don't have
      // to do another join. signalDefs already populated on mount.
      const defs = signalDefsRef.current;
      const next = [];
      for (const id of idSet) {
        const def = defs.get(id);
        if (def) next.push({ signal_id: id, ...def });
      }
      next.sort((a, b) => (a.source ?? '').localeCompare(b.source ?? '')
                       || (a.signal_name ?? '').localeCompare(b.signal_name ?? ''));
      setSessionSignals(next);
    } catch (err) {
      console.error('Error loading replay session data:', err);
      setReplaySessionData([]);
      setSessionSignals([]);
    } finally {
      setIsLoading(false);
    }
  }, []);
```

- [ ] **Step 2: Sanity build**

```
cd frontend/interface && npx vite build
```

Expected: build succeeds.

- [ ] **Step 3: Manual verification of the bug fix**

```
cd frontend/interface && npm run dev
```

Open `/` (Home). Switch to replay mode, pick a date and session you know has the previously-missing signal. Confirm it now appears in the picker.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/interface/src/context/SessionContext.jsx
git commit -m "SessionContext: derive sessionSignals from get_session_signal_ids (fix blank filter)"
```

---

## Task 10: Final regression sweep

- [ ] **Step 1: Full test suite**

```
cd frontend/interface && npx vitest run
```

Expected: PASS — all suites.

```
cd packages/widgets && npx vitest run
```

Expected: PASS — all suites (the `availableSignalIds` change should not break hover-sync or any existing test; if a test expected the picker to show all catalog entries unconditionally, update it to pass the new prop as `null`).

- [ ] **Step 2: Production build**

```
cd frontend/interface && npx vite build
```

Expected: succeeds.

- [ ] **Step 3: End-to-end manual check on `/app`**

```
cd frontend/interface && npm run dev
```

For a session you know has multi-signal data:
1. `/app?mode=replay` — date picker + session dropdown visible.
2. Pick a session — sidebar shows only signals with data in that session.
3. Drag the first signal into a graph — populates within ~1s.
4. Add a second signal — only the new signal is fetched (Network tab: one `get_signals_window` call with one ID in `p_signal_ids`).
5. Remove and re-add the first signal — no new network call.
6. Switch sessions — store resets; new session's signals appear.
7. Hover on a graph — other graphs show the synchronized cursor (regression check that hover sync still works).

Stop the dev server.

- [ ] **Step 4: Commit any test fixups**

If Step 1 required test updates, commit them:

```bash
git add -A
git commit -m "tests: update for availableSignalIds dock prop"
```

---

## Self-Review Notes

- **Spec coverage:**
  - New RPC → Task 1.
  - Layer 1 catalog (unchanged) → still served by existing `useSupabaseCatalog`.
  - Layer 2 hook → Task 4.
  - Layer 3 lazy fetch + LRU cache → Tasks 2, 3, 5.
  - Shared date+session picker → Task 6.
  - `/app` swap → Tasks 7, 8.
  - `/` (SessionContext) bug fix → Task 9.
  - Regression sweep including hover-sync check → Task 10.
- **Out-of-scope deferrals** (materialized overview, streaming, live-mode, CSV) are not introduced anywhere.
- **Type consistency:** `Status` is reused as `'idle' | 'loading' | 'ready' | 'error'` in the new hook; `useSupabaseFrames` keeps its richer `FetchStatus` union for back-compat with the dock's status indicator.
- **No placeholders** detected; every step has concrete code or a concrete command.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-fetching-and-session-picker.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — Execute tasks in this session with checkpoints.

Which approach?
