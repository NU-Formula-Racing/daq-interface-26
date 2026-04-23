-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE signal_definitions (
  id           SMALLSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  signal_name  TEXT NOT NULL,
  unit         TEXT,
  description  TEXT,
  UNIQUE (source, signal_name)
);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  track        TEXT,
  driver       TEXT,
  car          TEXT,
  notes        TEXT,
  source       TEXT NOT NULL CHECK (source IN ('live','sd_import')),
  source_file  TEXT,
  synced_at    TIMESTAMPTZ
);
CREATE INDEX sessions_date_idx ON sessions (date);
CREATE INDEX sessions_unsynced_idx ON sessions (synced_at) WHERE synced_at IS NULL;

CREATE TABLE sd_readings (
  ts           TIMESTAMPTZ NOT NULL,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_id    SMALLINT NOT NULL REFERENCES signal_definitions(id),
  value        DOUBLE PRECISION NOT NULL
);
CREATE INDEX sd_readings_lookup_idx ON sd_readings (session_id, signal_id, ts);

CREATE TABLE rt_readings (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_id    SMALLINT NOT NULL REFERENCES signal_definitions(id),
  value        DOUBLE PRECISION NOT NULL
);
CREATE INDEX rt_readings_signal_time_idx ON rt_readings (signal_id, ts DESC);

CREATE TABLE app_config (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton config row so callers never need ON CONFLICT upserts.
INSERT INTO app_config (id) VALUES (1);
