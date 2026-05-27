-- Live-cloud-sync: replicate live (basestation) sessions to Supabase with a
-- 12 h rolling retention. Separate from `sessions` / `session_blobs` because
-- the lifecycle is completely different: short-lived, no Parquet, anyone with
-- the bundled anon key can read, only the recording desktop writes.

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

-- RLS intentionally left disabled — matches the existing convention in this
-- project (sessions, signal_definitions, session_blobs are all RLS-off). The
-- desktop writes with the anon key; the website reads with the anon key.

-- Same shape as get_signals_window but reading live_readings. Lets the app
-- and website reuse the existing windowed-fetch pattern.
CREATE OR REPLACE FUNCTION get_live_signals_window(
  p_session_id   UUID,
  p_signal_ids   INTEGER[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  DOUBLE PRECISION
)
RETURNS TABLE (
  ts          TIMESTAMPTZ,
  signal_id   INTEGER,
  signal_name TEXT,
  unit        TEXT,
  value_min   DOUBLE PRECISION,
  value_max   DOUBLE PRECISION,
  value_avg   DOUBLE PRECISION,
  sample_n    INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM r.ts) / p_bucket_secs) * p_bucket_secs) AS ts,
    r.signal_id,
    d.signal_name,
    d.unit,
    min(r.value)            AS value_min,
    max(r.value)            AS value_max,
    avg(r.value)            AS value_avg,
    count(*)::INT           AS sample_n
  FROM live_readings r
  JOIN signal_definitions d ON d.id = r.signal_id
  WHERE r.session_id = p_session_id
    AND r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4
  ORDER BY 1;
$$;

-- Hourly retention. live_readings cascades from live_sessions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'live-sync-retention',
  '0 * * * *',
  $$DELETE FROM live_sessions WHERE started_at < now() - interval '12 hours'$$
);
