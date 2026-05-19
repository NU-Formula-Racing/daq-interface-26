# Frontend Fetching Rework + Calendar Session Picker

**Date:** 2026-05-18
**Scope:** `frontend/interface` web app (`/` and `/app` routes).
**Goals:**
1. Fix the "active signals" filter so it never hides signals that actually have data.
2. Make data fetching fast at 1–2M rows/session by being lazy and per-signal.
3. Replace the flat "all sessions" dropdown on `/app` with a calendar date picker + that day's session list.
4. Unify `/` and `/app` on one fetching layer so both routes get the fix.

## Problem Statement

### Bug: active-signals filter under-includes
`SessionContext.loadReplaySessionData` derives the per-session signal list as:

```
get_session_signals(session_id)  ∩  { signal_names present in get_session_overview }
```

The right side of that intersection is a value fetch — it silently drops signals whose 1-second bucket avg is NULL, whose rows fall past the paginated cap, or that have sub-second density the bucketer collapses. The filter shows fewer signals than the session actually contains.

### Bug: eager bulk fetch is slow
`get_session_overview` returns one row per (signal, 1-second bucket) for every signal in the session before the user has looked at anything. At 1–2M raw rows and ~80 signals, this is ~25× more data than is on screen at any moment.

### UX: flat session dropdown
`/app`'s session picker lists every session as one flat dropdown via `useSessionList(50)`. The older `/` route already has a date picker + per-day session list (in `SessionIndicator.jsx`). The new model should be the calendar one, applied everywhere.

## Architecture: three independent data layers

Each layer has one job and does not depend on the layer below it.

```
Layer 1: Signal catalog          → fetched once on app load
Layer 2: Signals-with-data-here  → fetched once per session-open
Layer 3: Bucketed values         → fetched per (signal, window, bucket), lazily
```

### Layer 1 — Global signal catalog
- Source: `signal_definitions` table (id, source, signal_name, unit, description).
- ~80 rows, ~10KB. Fetched once on app load; cached in memory for the session.
- Existing hook `useSupabaseCatalog` already does this.
- The sidebar uses this for names, units, and grouping.

### Layer 2 — Signals-with-data for current session
- New RPC: `get_session_signal_ids(p_session_id uuid) returns smallint[]`.
- Implementation: `SELECT array_agg(DISTINCT signal_id) FROM sd_readings WHERE session_id = $1`. Uses the existing composite index `(session_id, signal_id, timestamp)` for an index-only scan; sub-100ms even on millions of rows.
- Returns **integer IDs only**. No values, no timestamps.
- Fetched once on session-open; cached per session for the lifetime of the session selection.
- The sidebar enables/disables catalog rows based on membership in this set.

### Layer 3 — Bucketed values
- Existing RPC: `get_signals_window(session_id, signal_ids[], start, end, bucket_secs)`.
- Fetched only for signals currently visible (toggled on, or rendered in a widget). When new signals become visible together (e.g. a saved layout opens), they're batched into one multi-ID call.
- Bucket size is derived from the visible time window so output is ~800 buckets regardless of zoom level (`bucketFor` helper, already in repo).
- Cache key: `(session_id, signal_id, start, end, bucket_secs)`.

## Cache policy

- **Add:** entry inserted on successful fetch; LRU recency timestamp set.
- **Read:** recency timestamp refreshed.
- **Toggle signal off / delete graph:** no eviction. Entry stays so re-adding is instant.
- **Change time window (zoom/scrub):** new entries created for the new window; old window entries remain cached.
- **Session change:** entire layer-3 store cleared. Different session = different namespace.
- **Cap:** LRU bound on entries (default 64). When exceeded, drop least-recently-used. In practice rarely fires in one session; exists as a safety valve.

Layer 1 and Layer 2 are not subject to the LRU cap — they're tiny and always wanted.

## Components and data flow

```
useSupabaseCatalog()  ──►  catalog (id, name, source, unit)         [Layer 1]
                                       │
useSessionSignalIds(sid) ──►  Set<signal_id> for session            [Layer 2]
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                       Sidebar / picker     useSupabaseFrames
                       (enables names       (Layer 3 store,
                        in Layer 2)          LRU, lazy)
```

### New / changed pieces

- **New RPC** `get_session_signal_ids` in `frontend/database/supabase_functions.sql`.
- **New hook** `useSessionSignalIds(sessionId)` in `frontend/interface/src/adapters/`. Returns `{ ids: Set<number>, status }`.
- **New component** `<DateAndSessionPicker />` extracted from the calendar logic in `SessionIndicator.jsx`. Used by both `/` and `/app`.
- **Refactor** `SessionContext.loadReplaySessionData` to **stop** doing the eager `get_session_overview` fetch and the intersection. Instead it sets the current session and delegates value fetches to `useSupabaseFrames` consumers downstream.
- **Refactor** `AppRoute.jsx` to swap its flat `<select>` for `<DateAndSessionPicker />` and use `useSessionSignalIds` for the active-signals filter.

### Files affected

| File | Change |
|---|---|
| `frontend/database/supabase_functions.sql` | Add `get_session_signal_ids` |
| `frontend/interface/src/adapters/useSessionSignalIds.ts` | New |
| `frontend/interface/src/adapters/useSupabaseFrames.ts` | Add LRU cap; keep existing per-signal lazy behavior |
| `frontend/interface/src/adapters/SupabaseFramesStore.ts` | Add per-entry recency + eviction |
| `frontend/interface/src/components/DateAndSessionPicker.jsx` | New (extracted) |
| `frontend/interface/src/components/SessionIndicator.jsx` | Use new picker component |
| `frontend/interface/src/routes/AppRoute.jsx` | Swap flat select → picker; consume `useSessionSignalIds` |
| `frontend/interface/src/context/SessionContext.jsx` | Remove `get_session_overview` bulk fetch; remove name-intersection bug; consume `useSessionSignalIds` for `sessionSignals` |

## Error and edge cases

- **Empty session (no rows):** Layer 2 returns `[]`. Sidebar shows all catalog signals disabled. No layer-3 fetches issued.
- **Layer 2 fails:** sidebar falls back to "all catalog signals enabled" with a warning, so the user is not blocked.
- **Layer 3 fetch fails for a signal:** that signal's widget shows an error chip; other signals continue rendering. Failed entries are not cached (so retry on next toggle).
- **Session switched mid-fetch:** in-flight layer-3 calls are cancelled (existing `cancelled` flag pattern in `useSupabaseFrames`); store is reset.
- **Catalog not yet loaded:** sidebar shows a skeleton; layer 2 may complete first, which is fine — IDs render once catalog arrives.

## Testing

- **Unit:** `SupabaseFramesStore` LRU eviction order; `useSessionSignalIds` cancels on session change.
- **Integration (Supabase):** `get_session_signal_ids` returns identical set to `SELECT DISTINCT signal_id` for known sessions; verify timing under 100ms on a 1M-row session.
- **Regression:** load a known session where a signal has all-NULL 1-second buckets but real raw rows; confirm sidebar enables it (this is the original bug).
- **Manual:** toggle 10 signals on/off rapidly; verify only one batched RPC fires; verify re-toggle-on is instant (no network); verify zoom only refetches visible signals.

## Out of scope (deferred)

- Server-side materialized overview (Approach B from brainstorm). Revisit if Approach A's cold-start feels slow on real sessions.
- Streaming/chunked fetch.
- Changes to live mode (`rt_readings`) — fetching there is already realtime/push.
- Any change to the CSV download path.
