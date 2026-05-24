### Database Schema (v3 — Parquet/Blob Catalog)

#### Overview

Session row data (formerly in `sd_readings`) has moved out of Supabase Postgres and into
DigitalOcean Spaces as compressed Parquet files. Supabase now holds a thin **catalog** only:
`sessions`, `signal_definitions`, and `session_blobs`. The legacy tables `sd_readings` (and all its
monthly partitions) and `nfr26_signals` have been dropped from Supabase.

The local embedded Postgres (inside the desktop app) retains `sd_readings` — session rows are
imported there when a user pulls a session from the cloud.

---

#### Tables

**`signal_definitions`** — catalog of every distinct signal
- `id` SMALLINT (auto-increment PK)
- `source` TEXT — CAN message source (e.g. "PDM", "BMS_SOE")
- `signal_name` TEXT NOT NULL
- `unit` TEXT
- `description` TEXT
- UNIQUE constraint on `(source, signal_name)`

**`sessions`** — one row per driving session
- `id` UUID PK (auto-generated)
- `date` DATE NOT NULL (indexed)
- `started_at` TIMESTAMPTZ NOT NULL
- `ended_at` TIMESTAMPTZ
- `track` TEXT
- `driver` TEXT
- `car` TEXT
- `notes` TEXT
- `source` TEXT — `'live'` or `'sd_import'`
- `source_file` TEXT — original filename for SD imports
- `synced_at` TIMESTAMPTZ — set after a successful cloud upload
- `content_hash` TEXT — `session_content_hash` from manifest (cross-machine dedup key)
- `manifest_key` TEXT — object key of the session's `manifest.json` in DO Spaces
- `total_bytes` BIGINT — sum of all `session_blobs.bytes`
- `uploaded_by_machine` TEXT — identifier of the desktop that performed the upload
- `uploaded_at` TIMESTAMPTZ — wall-clock time the cloud upload completed

UNIQUE INDEX on `content_hash` WHERE `content_hash IS NOT NULL` — enforces dedup at the DB level.

**`session_blobs`** — one row per Parquet file uploaded to DO Spaces
- `session_id` UUID FK → sessions (CASCADE DELETE)
- `source` TEXT — CAN message source (e.g. "PDM", "BMS_SOE"); PK component
- `object_key` TEXT — full object key in DO Spaces (e.g. `sessions/<uuid>/PDM.parquet`)
- `bytes` BIGINT — file size in bytes
- `row_count` BIGINT — number of rows in the Parquet file
- `content_hash` TEXT — per-file SHA-256 of the Parquet bytes
- `uploaded_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- PRIMARY KEY `(session_id, source)`
- INDEX on `content_hash`

**`rt_readings`** — real-time telemetry, cleared nightly (unchanged)
- `timestamp` TIMESTAMPTZ NOT NULL (default now())
- `signal_id` SMALLINT FK → signal_definitions
- `value` DOUBLE PRECISION
- Index on `(signal_id, timestamp DESC)`
- Supabase Realtime enabled
- Truncated daily at 5am UTC via pg_cron

---

#### Parquet file layout (DO Spaces)

```
sessions/<session_id>/<source>.parquet
sessions/<session_id>/manifest.json
```

Per-file Parquet schema: `timestamp TIMESTAMP(MICROS, UTC)`, `signal_id INT16`, `value DOUBLE`.
Compression: ZSTD. Sort order within row groups: `(signal_id, timestamp)`.

The `manifest.json` records file list, byte sizes, row counts, per-file SHA-256s, and the derived
`session_content_hash` (SHA-256 of sorted per-file hashes).

---

#### RPC Functions (local Postgres only)

These RPCs read `sd_readings` and exist only in the **local** embedded Postgres. They have been
removed from Supabase as part of the v3 migration:

- `get_signal_downsampled(session_id, signal_id, bucket_interval)`
- `get_session_signals(session_id)`
- `get_signal_window(session_id, signal_id, start, end)`
- `get_session_overview(session_id, bucket_secs)`
- `get_session_signal_ids(session_id)`

---

#### Realtime

- `rt_readings` has Supabase Realtime enabled (INSERT events).

---

#### Scheduled Jobs

- `truncate-rt-readings`: `TRUNCATE rt_readings` at 5am UTC daily (pg_cron)

---

#### Dropped objects (v2 → v3)

- `sd_readings` and all monthly partitions (`sd_readings_2026_03` … `sd_readings_default`) — dropped from Supabase; data lives in DO Spaces as Parquet.
- `nfr26_signals` — legacy table, no longer used, dropped.
- All `sd_readings`-dependent RPCs listed above — dropped from Supabase.
