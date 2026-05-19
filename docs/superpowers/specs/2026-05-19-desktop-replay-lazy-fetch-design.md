# Desktop Replay: Lazy Per-Signal Fetch + Min/Max Band

**Date:** 2026-05-19
**Scope:** Desktop Electron app (`app/`, `desktop/main/`) + shared `@nfr/widgets` package.
**Goals:**
1. Stop displaying signals at a fixed 1 Hz regardless of zoom.
2. Retire the bulk-overview preload model on desktop entirely.
3. Always show ~1 point per pixel; let deep zoom resolve down to raw samples automatically.
4. Render a translucent min/max band behind each graph trace so transient spikes stay visible even at coarse zoom (BSPD debugging).

## Problem Statement

### Why graphs are stuck at 1 Hz

`app/src/pages/Replay.tsx:70` calls `useOverview(id!, 1)`, which preloads the entire session bucketed server-side at **1-second intervals** via `get_session_overview`. The fetch happens once at session open; the result is materialized into a static `FramesStore` façade by `makeReplayStore`. The graph widget's zoom is a **viewport zoom** — it slices into the existing in-memory buffer. There is no refetch.

So when the user zooms in on a 1-second slice, the buffer still only holds one point per second across the whole session. The widget displays one or zero data points and "stretches" the same coarse data over more pixels.

### Why this matters for BSPD

The BSPD logic reacts to sub-second transients in brake pressure and current draw. The CAN signals carrying those values arrive at ~500 Hz. A 1-second `avg` smooths the spikes away entirely; the data needed to debug the fault is unreachable through the UI.

### Why we can do better locally

The desktop talks to a **local Postgres** via `pg` Pool — round-trip is ~1 ms, there are no statement timeouts, and we control the pool size. None of the constraints that justified the bulk-preload pattern on the cloud apply here. Lazy per-signal, per-window fetching is the cheaper option locally.

## Architecture: three independent data layers

Same model as the cloud rework (see `docs/superpowers/specs/2026-05-18-fetching-and-session-picker-design.md`), with desktop-specific refinements.

```
Layer 1: Signal catalog              → fetched once on app load
Layer 2: Signals-with-data-here       → fetched once per session-open
Layer 3: Bucketed values per window   → fetched per (signal, window, bucket), lazily
```

### Layer 1 — Catalog
- Existing `/api/signal-definitions` route. Unchanged.

### Layer 2 — Signals-with-data
- New RPC `get_session_signal_ids(p_session_id UUID) RETURNS SETOF SMALLINT`. Implementation: same recursive-CTE loose-index-scan used in the cloud (see `frontend/database/supabase_functions.sql`).
- New desktop route `GET /api/sessions/:id/signal-ids` returning `number[]`.
- Powers the sidebar's "signals available in this session" filter (currently absent on desktop).

### Layer 3 — Bucketed values
- New RPC `get_signals_window(session_id UUID, signal_ids SMALLINT[], start TIMESTAMPTZ, end TIMESTAMPTZ, bucket_secs NUMERIC) RETURNS TABLE(ts, signal_id, value_avg, value_min, value_max, sample_n)`.
  - **`bucket_secs` is `NUMERIC`, not `INT`**. This is the only difference from the cloud version. The desktop has no statement timeout; we can ask for arbitrarily small buckets.
- New desktop route `GET /api/sessions/:id/signals/window?ids=…&start=…&end=…&bucket=…`.
- New React hook `useReplayFrames(args)` mirroring the website's `useSupabaseFrames`. Lazy per-signal, LRU-cached on `(session, signal_id, start, end, bucket_secs)`.

## Why one fetch path works at every zoom level

The bucketing SQL:

```sql
SELECT
  to_timestamp(floor(extract(epoch FROM ts) / bucket_secs) * bucket_secs) AS bucket,
  signal_id,
  avg(value)::DOUBLE PRECISION AS value_avg,
  min(value)::DOUBLE PRECISION AS value_min,
  max(value)::DOUBLE PRECISION AS value_max,
  count(*)::INT                AS sample_n
FROM sd_readings
WHERE session_id = $1 AND signal_id = ANY($2)
  AND ts >= $3 AND ts <= $4
GROUP BY bucket, signal_id
ORDER BY bucket, signal_id
```

The client always computes `bucket_secs = visible_duration / target_points` (target ≈ 800) and passes it verbatim. The output shape adapts automatically:

- `bucket_secs ≫ sample_period`: many samples per bucket. `avg` is a real downsample. `value_min`/`value_max` describe the in-bucket spread.
- `bucket_secs ≈ sample_period`: roughly 1 sample per bucket. `avg = min = max`.
- `bucket_secs ≪ sample_period`: most buckets are empty (no row emitted). The buckets that fire contain exactly one sample. The result is the raw points, with timestamps snapped to a sub-millisecond grid invisible on screen.

There is no `if (raw) { … } else { … }` branch on the client.

### Worked example: 50 000 samples across 600 s (~83 Hz)

| Action | `visible_duration` | `bucket_secs` | Samples/bucket | Rows returned | What user sees |
|---|---|---|---|---|---|
| Open graph | 600 s | 0.75 s | ~62 | 800 | Smoothed avg + wide min/max band |
| Zoom to 30 s | 30 s | 0.0375 s | ~3 | 800 | Near-raw avg, narrow band |
| Zoom to 1 s | 1 s | 0.00125 s | 0 or 1 | ~83 | Raw samples; band collapses to the line |
| Reset zoom | 600 s | 0.75 s | — | — | Cache hit — instant |

After all four actions the LRU holds three entries for that signal. Each future visit to one of those windows is free.

## Min/max band rendering

`get_signals_window` already returns `value_min`, `value_max`, `sample_n`. The widget store (`SupabaseFramesStore` on web, will be mirrored locally) already exposes these as `vMin`/`vMax` on each `FrameRow`. The widget today reads `value` but ignores the band.

Changes in `packages/widgets/src/widgets/widgets.tsx` `GraphWidget`:

- For each visible signal, render a `<path>` polygon between the min and max series **behind** the average `<path>`. Fill = signal color, opacity ≈ 0.18.
- Skip the band when every visible bucket has `sample_n ≤ 1` (deep zoom — band would just be a duplicate of the line, wasted SVG nodes).
- A per-widget config flag `showRange` (default `true`) on the graph widget so dense overview charts can opt out.
- Hover readout keeps showing `value` (the avg). Optional: tooltip mentions `[min … max]` when expanded.

## Zoom plumbing

`GraphWidget.onZoom(z: [t0, t1] | null)` already fires when the user drags-to-zoom on a graph (fractions of session duration, in `[0, 1]`). Today `Replay.tsx` stores `z` per-widget but does nothing else.

New flow:

1. `Replay.tsx` keeps a per-widget `zoom: [t0, t1] | null` state (already does).
2. The per-widget visible window is `[sessionStart + zoom[0]·duration, sessionStart + zoom[1]·duration]`, or the full session if `zoom === null`.
3. `useReplayFrames` is parameterized by `{ sessionId, signalIds, start, end }`. When `start`/`end` change, it computes a new `bucket_secs`, fetches missing IDs, and updates the store.
4. There is **one `useReplayFrames` hook per dock**, not per widget. It tracks the union of visible signals and the *current* visible window. (We start with the simpler model: the dock has one global zoom range derived from the most-recently-zoomed graph. Per-widget independent windows is a follow-up — see "Out of scope".)

## Caching

LRU keyed by `frameCacheKey(sessionId, [signalId], start, end, bucket_secs)`. Cap 64 entries.

- Add: on successful fetch, one entry per signal id (so `missing()` can return the subset still needed).
- Read: refresh recency.
- Toggle signal off / remove widget: no eviction.
- Change visible window (zoom): new cache entries created for the new `(start, end, bucket_secs)`; old entries remain.
- Session change: cache cleared (`resetSession`).

Identical semantics to the website's `FramesCache` — we'll reuse the same module from `frontend/interface/src/adapters/framesCache.ts` via the shared widgets package (move it into `packages/widgets` if it isn't already exported).

## Components and data flow

```
useSignalDefinitions()         ──►  catalog (id, name, source, unit)     [Layer 1, unchanged]
                                       │
useSessionSignalIds(sid)       ──►  Set<number> for session              [Layer 2, new]
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                       Sidebar / picker     useReplayFrames(args)
                       (filter by Layer 2)  (Layer 3 store, LRU, lazy)   [new]
                                                     │
                                                     ▼
                                              FramesStore — read by all widgets
```

## Files affected

| File | Change |
|---|---|
| `desktop/migrations/*.sql` | New migration adding `get_session_signal_ids` + `get_signals_window`; drops `get_session_overview`. |
| `desktop/main/src/db/signals.ts` | Add `getSessionSignalIds`, `getSignalsWindow`. |
| `desktop/main/src/db/sessions.ts` | Remove `get_session_overview` helper. |
| `desktop/main/src/server/routes/signals.ts` | Add `/signal-ids`, `/window`. |
| `desktop/main/src/server/routes/sessions.ts` | Remove `/overview` route. |
| `desktop/main/tests/db/rpcs.test.ts` | Tests for the two new RPCs; remove the overview test. |
| `app/src/hooks/useReplayFrames.ts` | New — fetch-based mirror of `useSupabaseFrames`. |
| `app/src/hooks/useSessionSignalIds.ts` | New — fetch-based mirror of the cloud hook. |
| `app/src/hooks/useOverview.ts` | Delete. |
| `app/src/pages/Replay.tsx` | Replace `useOverview` + `makeReplayStore` with `useReplayFrames`. Pass zoom state into the hook. |
| `app/src/api/types.ts` | Remove `OverviewRow`; add `SignalWindowRow`. |
| `packages/widgets/src/widgets/widgets.tsx` | Min/max band in `GraphWidget`; `showRange` config flag. |
| `packages/widgets/src/widgets/widgets.test.ts` (or new file) | Test the min/max band path renders/skips correctly. |

## Error and edge cases

- **Empty session (Layer 2 returns `[]`):** sidebar shows all catalog signals disabled. No layer-3 fetches issued.
- **Layer 2 fails:** sidebar falls back to "all catalog signals enabled" with a console warning. User isn't blocked.
- **Layer 3 fetch fails:** widget shows an error chip; other widgets continue. Failed entries are not cached so retry on next action.
- **Zoom rapidly changes:** in-flight fetches cancel via the `cancelled` flag pattern.
- **Very large duration with tiny `bucket_secs`:** still bounded — Postgres only emits non-empty buckets, so the result size is bounded by raw row count in the window. For a 1 s window at 500 Hz, that's 500 rows.
- **Zoom range outside session bounds:** clamped to `[sessionStart, sessionEnd]` by the hook.

## Testing

- **RPC tests** in `desktop/main/tests/db/rpcs.test.ts`:
  - `get_session_signal_ids` returns the same set as `SELECT DISTINCT signal_id`.
  - `get_signals_window` with various `bucket_secs` values (`1.0`, `0.05`, `0.001`) returns expected row counts and `value_avg`/`value_min`/`value_max` for a known fixture.
- **Hook tests** in `app/src/hooks/`:
  - `useReplayFrames`: no refetch on signal toggle-off-then-on; only new IDs fetched on signalIds change; session change resets store; in-flight cancellation on window change.
- **Widget test** in `packages/widgets/src/widgets/`:
  - `GraphWidget` renders min/max band when `sample_n > 1` exists.
  - `GraphWidget` omits band when every bucket has `sample_n ≤ 1`.

## Migration / rollout

This is the desktop app only — single-user, no public API. Just merge to main and rebuild the binary. The cloud `get_session_overview` RPC is not removed in this work (the website may still reference it; that's a separate cleanup).

## Out of scope (deferred)

- **Per-widget independent zoom windows.** Today's model assumes one visible time range per dock. Per-widget windows would require either per-widget `useReplayFrames` instances or a richer store API. Worth doing once we hit a concrete need.
- **Streaming/progressive fetch.** A 10-minute, 80-signal first paint will run ~80 RPCs in parallel — fine on local pg, but if it gets sluggish we can add request batching (`signalIds: number[]` per RPC).
- **Re-use of fetched windows for nested zoom.** If the user has cached the 600 s view and zooms to a sub-window, we could in principle filter the cached data instead of refetching. We don't, because the bucket size is wrong (0.75 s vs 0.0375 s) and the result would be visibly worse than refetching. Not an optimization worth doing.
- **Cloud `get_session_overview` cleanup.** Separate PR; the website doesn't reference it anymore but the SQL still exists.
- **Live mode.** Unchanged.
- **CSV export route (`/api/sessions/:id/export.csv`).** Unchanged.
