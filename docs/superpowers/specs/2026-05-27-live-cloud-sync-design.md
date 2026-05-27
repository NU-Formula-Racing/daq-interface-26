# Live-Cloud-Sync Design

**Date:** 2026-05-27

## Why

Live sessions are short-lived monitoring runs (basestation → LoRa → desktop).
The data isn't worth long-term Parquet/Spaces archival, but teammates on
laptops without a basestation should be able to *watch the same telemetry
in near-real-time* via a hosted web page. Today, live sessions also
incorrectly show up as "unsynced" in the Spaces upload list and produce
"session has no readings" errors when the basestation was idle.

## What

Live sessions get cloud-replicated to Supabase on a 2-second cadence,
kept for a rolling **12 hours**, then automatically deleted. Read-only
cloud consumers (the website) query Supabase directly. The desktop
ingests, buffers, and pushes; it does not poll the cloud for its own
live data.

## Architecture

### Cloud (Supabase)

Two new tables, mirroring the local schema but trimmed:

```sql
CREATE TABLE live_sessions (
  id          UUID PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  machine     TEXT,
  track       TEXT,
  driver      TEXT,
  car         TEXT,
  notes       TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX live_sessions_started_at_idx ON live_sessions (started_at DESC);

CREATE TABLE live_readings (
  ts         TIMESTAMPTZ NOT NULL,
  session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  signal_id  INTEGER NOT NULL,
  value      DOUBLE PRECISION NOT NULL
);
CREATE INDEX live_readings_lookup_idx
  ON live_readings (session_id, signal_id, ts);
```

A `signal_definitions` row in Supabase is already required by the SD
upload path; live signals reuse the same IDs (which match the local
catalog).

**RLS:** anon role can `SELECT` on both tables. INSERT/UPDATE/DELETE
gated to the authenticated `service_role` (used by the desktop's
existing write creds).

**Retention:** `pg_cron` job, runs hourly:
```sql
DELETE FROM live_sessions WHERE started_at < now() - interval '12 hours';
-- live_readings cascade-deleted by FK.
```

### Desktop

A new module `live_sync` in `desktop/main/src/cloud/`. Subscribes to the
parser event stream:

- On `session_started` (source=live):
  - Locally: `DELETE FROM sessions WHERE source = 'live' AND id <> $new_id`
    (cascade drops `rt_readings`).
  - Cloud: `INSERT INTO live_sessions` with the new id.
- On each `frames` event: push rows into an in-memory buffer.
- Every 2 s: bulk-insert the buffered rows into Supabase `live_readings`,
  clear the buffer.
- On `session_ended`: flush the buffer, `UPDATE live_sessions.ended_at`.

Gated by an `app_config.liveCloudSync` boolean (default true). If
Supabase calls fail the buffer is dropped (best-effort — we don't slow
the live UI to retry).

### App (replay)

Session picker gets a new top group "LIVE TODAY", populated from a new
hook `useLiveSessionsCloud()` that hits Supabase directly. Selecting a
live session routes to `/replay/live/:id`, a new path that uses
`get_live_signals_window` (mirror of `get_signals_window` but reads
`live_readings`). All existing replay widgets work unchanged because
they're parameterized over the frames store.

### Website

The `frontend/interface` package gets the same picker group + replay
route, using the bundled anon read creds (already in place).

## Out of scope (for this iteration)

- Tail-end visibility on the website (we don't push websockets — readers
  poll the window endpoint at the same 2 s cadence the desktop pushes).
- Cross-team auth (anyone with the page URL can watch).
- Replaying a *finished* live session more than 12 h later — by design,
  it's gone.

## Decisions locked

- Batch cadence: **2 s**
- Retention: **12 h rolling**
- Write creds: **desktop's existing personal write key**
- Read on website: **anon (bundled creds)**
- Local lifespan: **one live session at a time; new live wipes prior**
