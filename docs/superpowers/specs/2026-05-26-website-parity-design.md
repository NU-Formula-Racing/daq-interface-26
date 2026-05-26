# Website parity with desktop app + Spaces verification

**Date:** 2026-05-26 (revised after Task 1 discovery)
**Scope:** `frontend/interface/` (the public Vite website at nfrinterface.com) and a new Supabase Edge Function that proxies Parquet reads from DO Spaces.
**Out of scope:** any change under `app/`, `desktop/`, `parser/`, `packages/widgets/` source.

## Goal

Make the public website's `/app` route actually work for cloud-hosted sessions
by reading Parquet data from DigitalOcean Spaces via a Supabase Edge Function,
then bring the surrounding UI (session picker, active-signal filter) into
parity with the desktop app.

## Background

- The website shares widget code with desktop via the `@nfr/widgets` workspace
  package, so widget-level fixes propagate automatically.
- The Supabase Postgres for the website has only `sessions`,
  `signal_definitions`, `session_blobs` (Spaces object pointers), and
  `rt_readings` (live). **There is no `sd_readings` table on Supabase.**
  The bulk per-session signal data lives only as Parquet files in DO Spaces.
- The pre-existing Supabase SQL functions `get_signals_window` and
  `get_session_signal_ids` reference `sd_readings`, so they currently error
  out. The website's `/app` replay is non-functional in production today.

## Spaces layout (verified)

- Public base: `https://nfrinterface.sfo3.digitaloceanspaces.com`
- Per-session manifest: `sessions/<uuid>/manifest.json` listing one entry per
  CAN source (`BMS`, `ECU`, `DAQ-IMU`, ...). Each entry has `source`,
  `object_key`, `bytes`, `row_count`, `sha256`.
- Per-source Parquet: `sessions/<uuid>/<safe_source_name>.parquet`. Schema is
  `(timestamp TIMESTAMP, signal_id SMALLINT, value DOUBLE)`, sorted by
  `(signal_id, ts)`, ZSTD-compressed, ROW_GROUP_SIZE 1M.
- All objects are publicly readable; HTTP range reads work
  (DuckDB-WASM can stream a slice of a Parquet remotely).

## Architecture

```
Browser  ─supabase.functions.invoke('signals-window', body)─►  Supabase Edge Fn
                                                                     │
                                                                     ▼
                                                       DuckDB-WASM (in Deno)
                                                                     │
                                                              HTTP range reads
                                                                     ▼
                                            DO Spaces  (.../sessions/<id>/*.parquet)
```

Edge function performs aggregation server-side with DuckDB-WASM. Frontend
receives the same JSON shape as the (broken) RPC used to return — so widget
code is unchanged.

For the signal-id catalog per session, a new SQL function joins
`session_blobs` ↔ `signal_definitions` by `source` to enumerate the signal_ids
present in a session — no Parquet read needed.

## Components

### A. Supabase Edge Function `signals-window`

- Deno + `@duckdb/duckdb-wasm` (via npm import).
- **Request:**
  ```json
  {
    "session_id": "uuid",
    "signal_ids": [1, 7, 42],
    "start": "2026-05-17T22:33:10.703Z",
    "end":   "2026-05-17T22:34:51.658Z",
    "bucket_secs": 0.125
  }
  ```
- **Response:** Array of rows in the existing `RpcRow` shape:
  ```ts
  { ts: string; signal_id: number; signal_name: string; unit: string;
    value_min: number; value_max: number; value_avg: number; sample_n: number }
  ```
- **Algorithm:**
  1. Validate body.
  2. From Supabase Postgres, look up which `source` each `signal_id` belongs
     to (via `signal_definitions`).
  3. Group signal_ids by source → list of Parquet URLs to read.
  4. Open DuckDB-WASM in the edge runtime; run a single SQL that
     `UNION ALL`s the `read_parquet('<https-url>')` calls per source,
     filters by `signal_id IN (...)` and `ts ∈ [start, end)`, buckets via
     `to_timestamp(floor(extract(epoch FROM ts)/bucket)*bucket)`, and
     aggregates min/max/avg/count.
  5. JOIN against signal_definitions (preloaded as a small table) for
     `signal_name`/`unit`.
  6. Return the rows as JSON.

### B. Replace broken SQL functions

In `frontend/database/supabase_functions.sql`:
- Remove (or rewrite) `get_signals_window` — replaced by the edge function.
  Keep the SQL signature removal documented in a migration.
- Rewrite `get_session_signal_ids(p_session_id uuid)`:
  ```sql
  SELECT DISTINCT sd.id::smallint AS signal_id
  FROM session_blobs sb
  JOIN signal_definitions sd ON sd.source = sb.source
  WHERE sb.session_id = p_session_id;
  ```
- Rewrite `list_sessions(p_limit integer)` to also return `source` (needed
  by the new SessionPicker for `sd_import` filtering).

### C. Frontend adapter swap

In `frontend/interface/src/adapters/useSupabaseFrames.ts`:
- Replace `supabase.rpc('get_signals_window', ...)` with
  `supabase.functions.invoke('signals-window', { body: ... })`.
- Drop the integer-rounding from `bucket_secs` — edge fn accepts fractional.
- No widget changes.

### D. Active-signal filter

Once `get_session_signal_ids` is rewritten (component B), the filter starts
working again. Add a runtime diagnostic for one cycle to confirm.

### E. Desktop-style session picker

Unchanged from previous spec — port `app/src/components/SessionPicker.tsx`
to `frontend/interface/src/components/SessionPicker.jsx` (calendar grid → day
list, label = local time + short id, no `#N` numbering).

### F. Widget parity audit

Unchanged — confirm `@nfr/widgets` resolves to the workspace source so all
recent fixes (cursor snap, x-axis anchor, enum names, reset-zoom dot)
propagate.

## Verification checklist

- [ ] Edge function deployed; smoke test from `curl` returns rows for a known
      session and signal subset.
- [ ] `useSupabaseFrames` swapped to `functions.invoke`; website `/app` route
      renders a real session graph end-to-end.
- [ ] `get_session_signal_ids` returns non-empty `Set` for a known session;
      widget signal pickers hide signals not in the session.
- [ ] Session picker on the website is a calendar grid matching desktop UX
      with no `#N`.
- [ ] No source modified under `app/`, `desktop/`, `parser/`, or
      `packages/widgets/`.

## Non-goals

- No browser-side Parquet/Spaces fetch path (would also work via DuckDB-WASM
  but adds 3-5 MB to the bundle and complicates caching).
- No private-bucket auth — Spaces base is public-readable.
- No changes to the desktop upload format.
- No live-mode changes (`rt_readings` path untouched).
