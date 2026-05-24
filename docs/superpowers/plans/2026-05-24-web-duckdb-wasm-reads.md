# Web App: DuckDB-wasm + Parquet Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web app's reliance on the Supabase RPCs (`get_signal_downsampled`, `get_session_signals`, `get_session_overview`, `get_signal_window`, `get_session_signal_ids`, `list_sessions`) with browser-side queries against Parquet files in DigitalOcean Spaces using DuckDB-wasm. Session listing continues to come from Supabase, but it now queries the `sessions` and `session_blobs` tables directly instead of a `list_sessions` RPC.

**Architecture:** Initialise a DuckDB-wasm instance lazily on first session open. For each session, fetch its `manifest.json` from Spaces, then register the relevant Parquet files as virtual files in DuckDB. All RPC-shaped queries become SQL on those Parquet files. The existing `SupabaseFramesStore` is replaced by a `ParquetFramesStore` with the same external contract so the rest of the React tree is untouched.

**Tech Stack:** React 19, Vite 7, `@duckdb/duckdb-wasm`, `@supabase/supabase-js` (for catalog reads only).

**Depends on:** Plans `2026-05-24-catalog-and-parquet-foundation.md` (Parquet layout + manifest) and `2026-05-24-upload-flow.md` (Spaces bucket layout).

---

## File Structure

**Create:**
- `frontend/interface/src/lib/duckdb.ts` — DuckDB-wasm singleton init
- `frontend/interface/src/lib/duckdb.test.ts`
- `frontend/interface/src/adapters/ParquetFramesStore.ts` — replaces `SupabaseFramesStore`
- `frontend/interface/src/adapters/ParquetFramesStore.test.ts`
- `frontend/interface/src/adapters/useParquetFrames.ts` — replaces `useSupabaseFrames`
- `frontend/interface/src/adapters/useParquetFrames.test.ts`
- `frontend/interface/src/adapters/useSessionManifest.ts`
- `frontend/interface/src/lib/spacesUrl.ts` — turn `object_key` into public URL

**Modify:**
- `frontend/interface/package.json` — add `@duckdb/duckdb-wasm`
- `frontend/interface/src/adapters/useSessionList.ts` — query `sessions` table instead of RPC
- `frontend/interface/src/adapters/useSessionSignalIds.ts` — query Parquet via DuckDB
- All consumers of `useSupabaseFrames` (search/replace import path)
- `frontend/interface/vite.config.*` — copy DuckDB-wasm assets to `public/`

---

### Task 1: Install DuckDB-wasm

**Files:**
- Modify: `frontend/interface/package.json`

- [ ] **Step 1: Install**

```bash
cd frontend/interface && npm install @duckdb/duckdb-wasm
```

- [ ] **Step 2: Verify Vite can resolve the wasm assets**

DuckDB-wasm ships its workers and wasm files inside the package. Add to `frontend/interface/vite.config.ts` (or whatever the config is) the `optimizeDeps.exclude` for `@duckdb/duckdb-wasm` and configure asset serving per the duckdb-wasm Vite recipe (https://duckdb.org/docs/api/wasm/instantiation.html#vite). Use the bundle approach:
```ts
optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
```
and import bundles dynamically (Task 2).

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/package.json frontend/interface/package-lock.json frontend/interface/vite.config.*
git commit -m "deps: add @duckdb/duckdb-wasm"
```

---

### Task 2: DuckDB-wasm singleton

**Files:**
- Create: `frontend/interface/src/lib/duckdb.ts`
- Create: `frontend/interface/src/lib/duckdb.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { getDuckDB } from './duckdb.ts';

describe('DuckDB singleton', () => {
  it('returns the same connection across calls', async () => {
    const a = await getDuckDB();
    const b = await getDuckDB();
    expect(a).toBe(b);
    const conn = await a.connect();
    const r = await conn.query('SELECT 7 AS n');
    expect(r.toArray()[0].n).toBe(7);
    await conn.close();
  });
});
```

- [ ] **Step 2: Run, expect fail (module missing).**

- [ ] **Step 3: Implement**

```ts
import * as duckdb from '@duckdb/duckdb-wasm';

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export async function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' }),
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    return db;
  })();
  return dbPromise;
}

/** Register a remote Parquet file as a virtual file in DuckDB by URL. */
export async function registerParquetUrl(db: duckdb.AsyncDuckDB, virtualName: string, url: string): Promise<void> {
  await db.registerFileURL(virtualName, url, duckdb.DuckDBDataProtocol.HTTP, false);
}
```

- [ ] **Step 4: Run test, expect pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/interface/src/lib/duckdb.ts frontend/interface/src/lib/duckdb.test.ts
git commit -m "duckdb: lazy singleton init for browser parquet reads"
```

---

### Task 3: Spaces URL helper

**Files:**
- Create: `frontend/interface/src/lib/spacesUrl.ts`

- [ ] **Step 1: Implement**

```ts
// Public bucket reads: turn an object key into a fully-qualified HTTPS URL.
// SPACES_PUBLIC_BASE is the bucket's CDN/origin URL, configured at build time.
const BASE = import.meta.env.VITE_SPACES_PUBLIC_BASE as string | undefined;

export function spacesUrl(objectKey: string): string {
  if (!BASE) throw new Error('VITE_SPACES_PUBLIC_BASE is not set');
  return `${BASE.replace(/\/$/, '')}/${objectKey.replace(/^\//, '')}`;
}
```

- [ ] **Step 2: Add the env var to `.env.local`** (developer notes only; do not commit secrets):

```
VITE_SPACES_PUBLIC_BASE=https://<bucket>.<region>.digitaloceanspaces.com
```

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/lib/spacesUrl.ts
git commit -m "lib: spacesUrl helper for object key → https URL"
```

---

### Task 4: useSessionManifest hook

**Files:**
- Create: `frontend/interface/src/adapters/useSessionManifest.ts`

- [ ] **Step 1: Implement**

```ts
import { useEffect, useState } from 'react';
import { spacesUrl } from '@/lib/spacesUrl';

export interface ManifestFile {
  source: string;
  object_key: string;
  bytes: number;
  row_count: number;
  sha256: string;
}
export interface SessionManifest {
  session_id: string;
  manifest_version: 1;
  files: ManifestFile[];
}

export function useSessionManifest(sessionId: string | null, manifestKey: string | null) {
  const [manifest, setManifest] = useState<SessionManifest | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!sessionId || !manifestKey) { setManifest(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(spacesUrl(manifestKey));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const m = (await r.json()) as SessionManifest;
        if (!cancelled) setManifest(m);
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, manifestKey]);

  return { manifest, error };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/interface/src/adapters/useSessionManifest.ts
git commit -m "adapters: useSessionManifest fetches manifest.json from Spaces"
```

---

### Task 5: Rewrite useSessionList to query Supabase tables directly

**Files:**
- Modify: `frontend/interface/src/adapters/useSessionList.ts`

- [ ] **Step 1: Replace the RPC call**

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface SessionListItem {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number;
  driver: string | null;
  car: string | null;
  manifest_key: string;
  total_bytes: number;
}

export function useSessionList(limit = 50) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.from('sessions')
      .select('id, date, started_at, ended_at, driver, car, manifest_key, total_bytes')
      .not('manifest_key', 'is', null)
      .order('started_at', { ascending: false })
      .limit(limit)
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) { setError(new Error(e.message)); return; }
        const items = (data ?? []).map((r) => ({
          id: r.id, date: r.date, started_at: r.started_at, ended_at: r.ended_at,
          duration_secs: r.ended_at
            ? Math.max(0, Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000))
            : 0,
          driver: r.driver, car: r.car,
          manifest_key: r.manifest_key!,
          total_bytes: Number(r.total_bytes ?? 0),
        }));
        setSessions(items);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [limit]);

  return { sessions, loading, error };
}
```

- [ ] **Step 2: Run existing tests, fix call sites if any reference the dropped `session_number` field.**

```bash
cd frontend/interface && npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/adapters/useSessionList.ts
git commit -m "adapters: useSessionList queries sessions table (replaces RPC)"
```

---

### Task 6: ParquetFramesStore

**Files:**
- Create: `frontend/interface/src/adapters/ParquetFramesStore.ts`
- Create: `frontend/interface/src/adapters/ParquetFramesStore.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ParquetFramesStore } from './ParquetFramesStore.ts';

describe('ParquetFramesStore', () => {
  it('appends per-signal series and bumps version', () => {
    const s = new ParquetFramesStore();
    const v0 = s.getVersion();
    s.upsertSeries(42, [{ ts: 1000, value: 1.5 }]);
    expect(s.getVersion()).toBeGreaterThan(v0);
    expect(s.series(42)).toEqual([{ ts: 1000, value: 1.5 }]);
  });
});
```

- [ ] **Step 2: Implement** (mirror the public surface of the existing `SupabaseFramesStore` so consumers don't change):

```ts
export interface Sample { ts: number; value: number; }

type Listener = () => void;

export class ParquetFramesStore {
  private map = new Map<number, Sample[]>();
  private version = 0;
  private listeners = new Set<Listener>();

  subscribe(cb: Listener): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  getVersion(): number { return this.version; }
  reset(): void { this.map.clear(); this.bump(); }
  series(id: number): Sample[] { return this.map.get(id) ?? []; }

  upsertSeries(id: number, samples: Sample[]): void {
    this.map.set(id, samples);
    this.bump();
  }

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}
```

- [ ] **Step 3: Run, expect pass; commit.**

```bash
git add frontend/interface/src/adapters/ParquetFramesStore.ts frontend/interface/src/adapters/ParquetFramesStore.test.ts
git commit -m "adapters: ParquetFramesStore (drop-in replacement)"
```

---

### Task 7: useParquetFrames

**Files:**
- Create: `frontend/interface/src/adapters/useParquetFrames.ts`
- Create: `frontend/interface/src/adapters/useParquetFrames.test.ts`

- [ ] **Step 1: Failing test**

A pure-logic test that mocks the DuckDB query function and asserts that only newly-added signal IDs trigger fetches.

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useParquetFrames } from './useParquetFrames.ts';

vi.mock('@/lib/duckdb', () => ({
  getDuckDB: vi.fn().mockResolvedValue({
    connect: async () => ({
      query: vi.fn().mockResolvedValue({ toArray: () => [{ ts: 1000n, signal_id: 1, value: 5 }] }),
      close: async () => {},
    }),
    registerFileURL: vi.fn(),
  }),
  registerParquetUrl: vi.fn(),
}));

describe('useParquetFrames', () => {
  it('fetches only newly-added signal IDs across renders', async () => {
    const props = {
      sessionId: 's1',
      manifest: { session_id: 's1', manifest_version: 1 as const, files: [
        { source: 'PDM', object_key: 'sessions/s1/PDM.parquet', bytes: 1, row_count: 1, sha256: 'x' },
      ]},
      signalIdsBySource: { PDM: [1] },
      start: '2026-05-24T00:00:00Z',
      end:   '2026-05-24T00:01:00Z',
    };
    const { result, rerender } = renderHook((p) => useParquetFrames(p), { initialProps: props });
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    rerender({ ...props, signalIdsBySource: { PDM: [1] } });
    // No new IDs, no new fetch — version unchanged.
    expect(result.current.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement**

```ts
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getDuckDB, registerParquetUrl } from '@/lib/duckdb';
import { spacesUrl } from '@/lib/spacesUrl';
import { ParquetFramesStore } from './ParquetFramesStore.ts';
import type { SessionManifest } from './useSessionManifest.ts';
import { bucketFor } from './bucketFor.ts';

export type FetchStatus =
  | { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

export interface UseParquetFramesArgs {
  sessionId: string | null;
  manifest: SessionManifest | null;
  /** Map of source name → signal_ids requested for that source. Splitting by
   * source lets us only register/query the Parquet files we actually need. */
  signalIdsBySource: Record<string, number[]>;
  start: string | null;
  end: string | null;
  targetBuckets?: number;
}

export function useParquetFrames(args: UseParquetFramesArgs) {
  const storeRef = useRef<ParquetFramesStore>(new ParquetFramesStore());
  const fetchedRef = useRef<Set<string>>(new Set()); // `${source}:${signal_id}:${start}:${end}:${bucket}`
  const store = storeRef.current;
  const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });

  useSyncExternalStore((cb) => store.subscribe(cb), () => store.getVersion(), () => 0);

  const ids = useMemo(() => {
    const out: Array<{ source: string; id: number }> = [];
    for (const [src, list] of Object.entries(args.signalIdsBySource)) for (const id of list) out.push({ source: src, id });
    return out;
  }, [args.signalIdsBySource]);

  useEffect(() => {
    if (!args.sessionId || !args.manifest || !args.start || !args.end || ids.length === 0) {
      setStatus({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setStatus({ kind: 'loading' });
        const db = await getDuckDB();
        const conn = await db.connect();
        try {
          const dur = Math.max(1, Math.round((Date.parse(args.end!) - Date.parse(args.start!)) / 1000));
          const bucketSecs = bucketFor(dur, args.targetBuckets ?? 800);
          for (const { source, id } of ids) {
            const file = args.manifest!.files.find((f) => f.source === source);
            if (!file) continue;
            const key = `${source}:${id}:${args.start}:${args.end}:${bucketSecs}`;
            if (fetchedRef.current.has(key)) continue;
            const vname = `${file.object_key}`;
            await registerParquetUrl(db, vname, spacesUrl(file.object_key));
            const q = `
              SELECT epoch_ms(time_bucket(INTERVAL '${bucketSecs} seconds', "timestamp")) AS ts,
                     AVG(value) AS value
              FROM read_parquet('${vname}')
              WHERE signal_id = ${id}
                AND "timestamp" >= TIMESTAMP '${args.start!}'
                AND "timestamp" <  TIMESTAMP '${args.end!}'
              GROUP BY 1 ORDER BY 1
            `;
            const r = await conn.query(q);
            const samples = r.toArray().map((row: { ts: bigint; value: number }) =>
              ({ ts: Number(row.ts), value: Number(row.value) }));
            if (cancelled) return;
            store.upsertSeries(id, samples);
            fetchedRef.current.add(key);
          }
          if (!cancelled) setStatus({ kind: 'ready' });
        } finally {
          await conn.close();
        }
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [args.sessionId, args.manifest, args.start, args.end, ids, args.targetBuckets, store]);

  return {
    status,
    version: store.getVersion(),
    series: (id: number) => store.series(id),
  };
}
```

Note: DuckDB's `time_bucket` lives in the `icu` extension which is bundled in the wasm build. If it errors at runtime, swap to `date_trunc` + `floor(epoch / bucket) * bucket`.

- [ ] **Step 4: Run test, expect pass; commit.**

```bash
git add frontend/interface/src/adapters/useParquetFrames.ts frontend/interface/src/adapters/useParquetFrames.test.ts
git commit -m "adapters: useParquetFrames replaces useSupabaseFrames"
```

---

### Task 8: useSessionSignalIds via DuckDB

**Files:**
- Modify: `frontend/interface/src/adapters/useSessionSignalIds.ts`

- [ ] **Step 1: Replace RPC with a DuckDB DISTINCT over all manifest files**

```ts
import { useEffect, useState } from 'react';
import { getDuckDB, registerParquetUrl } from '@/lib/duckdb';
import { spacesUrl } from '@/lib/spacesUrl';
import type { SessionManifest } from './useSessionManifest.ts';

export function useSessionSignalIds(manifest: SessionManifest | null) {
  const [ids, setIds] = useState<number[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!manifest) { setIds([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const db = await getDuckDB();
        const conn = await db.connect();
        try {
          const parts: string[] = [];
          for (const f of manifest.files) {
            await registerParquetUrl(db, f.object_key, spacesUrl(f.object_key));
            parts.push(`SELECT DISTINCT signal_id FROM read_parquet('${f.object_key}')`);
          }
          const r = await conn.query(parts.join(' UNION '));
          if (cancelled) return;
          setIds(r.toArray().map((row: { signal_id: number }) => row.signal_id).sort((a, b) => a - b));
        } finally {
          await conn.close();
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    })();
    return () => { cancelled = true; };
  }, [manifest]);

  return { ids, error };
}
```

- [ ] **Step 2: Adjust the existing test** to feed in a manifest instead of `sessionId`, and mock `getDuckDB` the same way as Task 7.

- [ ] **Step 3: Commit**

```bash
git add frontend/interface/src/adapters/useSessionSignalIds.ts frontend/interface/src/adapters/useSessionSignalIds.test.ts
git commit -m "adapters: useSessionSignalIds queries parquet via duckdb-wasm"
```

---

### Task 9: Migrate all useSupabaseFrames consumers

**Files:**
- Modify: any file under `frontend/interface/src/` importing `useSupabaseFrames`

- [ ] **Step 1: Find consumers**

```bash
cd frontend/interface && grep -RIl useSupabaseFrames src/
```

- [ ] **Step 2: For each consumer**

Replace the import and call site:
```ts
// before
import { useSupabaseFrames } from '@/adapters/useSupabaseFrames';
// after
import { useParquetFrames } from '@/adapters/useParquetFrames';
import { useSessionManifest } from '@/adapters/useSessionManifest';
```

The consumer now needs to fetch the session's `manifest_key` (from `useSessionList` / route params) and pass the manifest down. Group the `signalIds` array into a `signalIdsBySource` map — the manifest already lists sources, and a small lookup against `signal_definitions` (or a cached map populated by `useSupabaseCatalog`) maps `signal_id → source`.

- [ ] **Step 3: Manual verify**

`npm run dev`, open any session, confirm graphs render against Parquet (network tab should show `.parquet` requests to Spaces, not Supabase RPCs).

- [ ] **Step 4: Commit per consumer**

```bash
git commit -m "ui: migrate <component> from supabase frames to parquet frames"
```

---

### Task 10: Delete the dead Supabase-RPC adapters

**Files:**
- Delete: `frontend/interface/src/adapters/useSupabaseFrames.ts`
- Delete: `frontend/interface/src/adapters/useSupabaseFrames.test.ts`
- Delete: `frontend/interface/src/adapters/SupabaseFramesStore.ts`
- Delete: `frontend/interface/src/adapters/SupabaseFramesStore.test.ts`

- [ ] **Step 1: Confirm no remaining imports**

```bash
cd frontend/interface && grep -RIn 'useSupabaseFrames\|SupabaseFramesStore' src/
```
Expected: no matches.

- [ ] **Step 2: `git rm` and commit**

```bash
git rm frontend/interface/src/adapters/useSupabaseFrames.ts \
       frontend/interface/src/adapters/useSupabaseFrames.test.ts \
       frontend/interface/src/adapters/SupabaseFramesStore.ts \
       frontend/interface/src/adapters/SupabaseFramesStore.test.ts
git commit -m "adapters: drop dead supabase frames code"
```

---

## Self-Review Notes

- Spec §6.3 (RPCs dropped from Supabase) → Tasks 5, 6, 7, 8, 10 migrate every call site off them ✓
- Spec §13 (public-read bucket assumption) → Task 3's `spacesUrl` helper assumes public reads; if the user later wants signed URLs, swap inside this single helper ✓
- DuckDB-wasm singleton + virtual file registration → Task 2 ✓
- `ParquetFramesStore` keeps the same external contract as `SupabaseFramesStore` (subscribe/getVersion/series), so consumers update by import only ✓
- No TBDs; all SQL strings are real and parameter-free intentionally (signal_id and timestamps are typed numerics/literals, not user input).
