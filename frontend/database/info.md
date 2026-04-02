### Database Schema (v2 — Normalized)

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

**`sd_readings`** — bulk historical data from SD card
- `timestamp` TIMESTAMPTZ NOT NULL
- `session_id` UUID FK → sessions
- `signal_id` SMALLINT FK → signal_definitions
- `value` DOUBLE PRECISION
- No surrogate PK (saves 8 bytes/row)
- Composite index on `(session_id, signal_id, timestamp)`
- Partitioned by month on `timestamp` (native PG range partitioning)

**`rt_readings`** — real-time telemetry, cleared nightly
- `timestamp` TIMESTAMPTZ NOT NULL (default now())
- `signal_id` SMALLINT FK → signal_definitions
- `value` DOUBLE PRECISION
- Index on `(signal_id, timestamp DESC)`
- Supabase Realtime enabled
- Truncated daily at 5am UTC via pg_cron

#### Partitions (sd_readings)

Monthly partitions: `sd_readings_2026_03` through `sd_readings_2026_12`, plus `sd_readings_default`.

#### RPC Functions

- `get_signal_downsampled(session_id, signal_id, bucket_interval)` — per-signal time-bucketed averages
- `get_session_signals(session_id)` — distinct signals available in a session
- `get_signal_window(session_id, signal_id, start, end)` — raw data for zoom detail
- `get_session_overview(session_id, bucket_secs)` — all signals bucketed for replay dashboard

#### Realtime

- `rt_readings` table has Supabase Realtime enabled (INSERT events)
- Old `nfr26_signals` table has Realtime disabled

#### Scheduled Jobs

- `truncate-rt-readings`: `TRUNCATE rt_readings` at 5am UTC daily (pg_cron)

#### Legacy

The old `nfr26_signals` table still exists but is no longer used by the frontend.
All data has been migrated to the new normalized schema.
