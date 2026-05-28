# Daily Live-Mode Design

**Date:** 2026-05-28

## Why

Live mode is broken on the desktop today. The visible symptom is "no
frames arrive in the dock"; the root cause is a wire-format mismatch
in the serial reader (it expects `0xAA 0x55` sync bytes that the
basestation firmware never sends, so every byte is discarded as desync
garbage).

Beyond the bug, the existing live model is also wrong for our actual
use. It pretends live recordings are "sessions" — each one opens a
sessions row, writes through `rt_readings`, and on `session_ended`
copies into `sd_readings`. That makes sense for SD imports but adds
unhelpful state for live monitoring: ephemeral data accumulates as
persistent sessions, the picker fills with short test-run rows, and
the user has to manually delete them.

The redesign treats live data as **a single rolling daily buffer** with
no session abstraction. Users see today's data; tomorrow it's gone.

## What

A new table `live_today (ts, signal_id, value)` holds every live
reading received today (in Chicago time). The table is truncated at
Chicago midnight. The parser, in live mode, writes directly to this
table and continues emitting the existing `frames` WebSocket events
the dock already consumes.

The app's live mode is replay-style against this daily table:
- Default view: today's Chicago-midnight → "now".
- Right-edge follows live frames in real time via the WS push that
  already exists.
- Scrolling back triggers a windowed fetch against a new RPC
  `get_live_today_window`, same shape as `get_signals_window`.
- Scrolling forward toward "now" needs no extra logic — the in-memory
  FramesStore already has the tail from WS.

No Supabase syncing. Local-only.

## Architecture

### Local database

```sql
CREATE TABLE live_today (
  ts         TIMESTAMPTZ NOT NULL,
  signal_id  INTEGER NOT NULL,
  value      DOUBLE PRECISION NOT NULL
);
CREATE INDEX live_today_lookup_idx ON live_today (signal_id, ts);
```

No `session_id`. No foreign keys. No partitioning. Truncated by the
desktop server (no `pg_cron` in the embedded Postgres) at:

1. Server boot — `DELETE FROM live_today WHERE ts < <today's Chicago midnight UTC>`.
2. A `setInterval` task every 15 minutes runs the same DELETE.

The DELETE is cheap because the index covers `(signal_id, ts)` and most
rows are from "today" so the predicate selects very few rows under
normal operation.

The legacy `rt_readings` table is dropped; the `move_rt_to_sd` codepath
is removed. Live mode no longer produces a `sessions` row.

### RPC

```sql
CREATE FUNCTION get_live_today_window(
  p_signal_ids   INTEGER[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  DOUBLE PRECISION
) RETURNS TABLE (
  ts          TIMESTAMPTZ,
  signal_id   INTEGER,
  signal_name TEXT,
  unit        TEXT,
  value_min   DOUBLE PRECISION,
  value_max   DOUBLE PRECISION,
  value_avg   DOUBLE PRECISION,
  sample_n    INT
) LANGUAGE SQL STABLE AS $$ ... $$;
```

Identical structure to `get_signals_window`; just reads `live_today`
and has no `p_session_id` parameter.

### Parser

`parser/live.py` already drives a streaming source through a CAN
decoder and into Postgres via `copy_rt_readings`. The change is two
small edits:

1. **Don't open a session in live mode.** Currently `live.py` calls
   `open_session(...)` and emits `session_started`. Skip both. The
   parser still emits `frames` events on the protocol stream (so the
   dock WS keeps working).
2. **Write to `live_today`.** Rename `copy_rt_readings` to
   `copy_live_today` and target the new table.

Replay-from-file (`__main__.py` mode=replay) keeps the existing
session lifecycle because it's hydrating a deterministic file into
`sd_readings`. We add a `streaming_only: bool` parameter to
`run_live` (defaults False; True when called from the live serial
path) to gate which behaviour applies.

### Desktop server

- Parser-event router stops listening for `session_started`/`session_ended`
  in live mode (they're no longer emitted). `frames` events continue to
  fan out to the WS broadcaster unchanged.
- Boot-time `DELETE FROM live_today WHERE ts < <today CDT/CST midnight>`.
- 15-minute interval timer runs the same DELETE.
- The existing live-cloud-sync worker (`live-stream.ts`) is unhooked in
  this iteration — it depended on `session_started` events that no
  longer fire. Cloud sync of live frames is out of scope for this redesign
  (covered separately if/when we want it back).

### App live mode

- `app/src/pages/Live.tsx` is the entry point; it stays.
- A new hook `useLiveTodayFrames` replaces `useLiveFrames`:
  - Owns a `FramesStore` (identical class to today's).
  - Subscribes to the existing parser WS event stream and ingests
    `frames` rows.
  - Exposes an `ensureWindow(start, end, signalIds)` method that
    fetches missing data via `get_live_today_window` and ingests the
    result into the same store.
- `Live.tsx` calls `ensureWindow(today_midnight, now, signalIds)` on
  mount so initial scroll-back works even if frames have been arriving
  to the table while the app was closed.
- Bottom slider behaviour:
  - `t = 1` (default): right edge is "now"; auto-advance is driven by
    incoming WS frames updating `latestTs()`.
  - `t < 1`: right edge frozen at the scrubbed position; widgets render
    the visible slice from the same FramesStore. Going back to `t = 1`
    resumes following.

### Session picker

The "MOST RECENT LIVE SESSION" group introduced in v0.5.12 is removed;
live data is no longer a session. The picker shows only SD imports.

## Out of scope

- Cloud replication of live data (was Phase 2-4 of the cloud-sync
  initiative; the previous design's local→cloud signal-id translation
  remains in `live-stream.ts` but the call site that wired it to the
  parser will be removed). Re-enable later if needed.
- Per-signal subsampling. We keep every frame.
- Multi-day retention (tomorrow's open of the app erases yesterday's
  data, by design).

## Decisions locked

- Single table `live_today`, no partitions, truncated at America/Chicago midnight.
- Cleanup driven by desktop server (no `pg_cron` available locally).
- WebSocket continues to push frames in real time (sub-second latency at the edge).
- Historical window fetch via new `get_live_today_window` RPC.
- No `sessions` row for live mode.
- No cloud sync in this iteration.
