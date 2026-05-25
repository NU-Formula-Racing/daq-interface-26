-- Repair / re-apply every RPC the desktop relies on.
--
-- Older data directories (USB-resident or otherwise) may have had migrations
-- 0002–0005 marked applied at a time when those files contained a different
-- set of CREATE FUNCTION statements. schema_migrations tracks the version
-- name, not file contents, so the new content never runs on a re-install.
-- This migration is idempotent: every function uses CREATE OR REPLACE, so
-- running it against a fresh DB is a no-op (it just overwrites with the
-- same definition that 0002–0005 just installed).

CREATE OR REPLACE FUNCTION get_session_signals(p_session_id UUID)
RETURNS TABLE (
  signal_id   SMALLINT,
  source      TEXT,
  signal_name TEXT,
  unit        TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT DISTINCT
    sr.signal_id,
    sd.source,
    sd.signal_name,
    sd.unit
  FROM sd_readings sr
  JOIN signal_definitions sd ON sd.id = sr.signal_id
  WHERE sr.session_id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION get_signal_window(
  p_session_id UUID,
  p_signal_id  SMALLINT,
  p_start      TIMESTAMPTZ,
  p_end        TIMESTAMPTZ
)
RETURNS TABLE (
  ts    TIMESTAMPTZ,
  value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT ts, value
  FROM sd_readings
  WHERE session_id = p_session_id
    AND signal_id  = p_signal_id
    AND ts >= p_start
    AND ts <= p_end
  ORDER BY ts;
$$;

CREATE OR REPLACE FUNCTION get_signal_downsampled(
  p_session_id      UUID,
  p_signal_id       SMALLINT,
  p_bucket_interval INTERVAL
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  avg_value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(
      floor(extract(epoch FROM ts) / extract(epoch FROM p_bucket_interval))
      * extract(epoch FROM p_bucket_interval)
    ) AS bucket,
    avg(value) AS avg_value
  FROM sd_readings
  WHERE session_id = p_session_id
    AND signal_id  = p_signal_id
  GROUP BY bucket
  ORDER BY bucket;
$$;

CREATE OR REPLACE FUNCTION get_session_overview(
  p_session_id  UUID,
  p_bucket_secs INT
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  signal_id SMALLINT,
  avg_value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM ts) / p_bucket_secs) * p_bucket_secs) AS bucket,
    signal_id,
    avg(value) AS avg_value
  FROM sd_readings
  WHERE session_id = p_session_id
  GROUP BY bucket, signal_id
  ORDER BY bucket, signal_id;
$$;

CREATE OR REPLACE FUNCTION get_signals_window(
  p_session_id   UUID,
  p_signal_ids   SMALLINT[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  INT
)
RETURNS TABLE (
  ts          TIMESTAMPTZ,
  signal_id   SMALLINT,
  signal_name TEXT,
  unit        TEXT,
  value_min   DOUBLE PRECISION,
  value_max   DOUBLE PRECISION,
  value_avg   DOUBLE PRECISION,
  sample_n    INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM r.ts) / p_bucket_secs) * p_bucket_secs) AT TIME ZONE 'UTC' AS ts,
    r.signal_id,
    d.signal_name,
    d.unit,
    min(r.value)            AS value_min,
    max(r.value)            AS value_max,
    avg(r.value)            AS value_avg,
    count(*)::INT           AS sample_n
  FROM sd_readings r
  JOIN signal_definitions d ON d.id = r.signal_id
  WHERE r.session_id = p_session_id
    AND r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4
  ORDER BY 1;
$$;

DROP FUNCTION IF EXISTS list_sessions(INT);
CREATE OR REPLACE FUNCTION list_sessions(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  date          DATE,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_secs INT,
  driver        TEXT,
  car           TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    s.id, s.date, s.started_at, s.ended_at,
    EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::INT AS duration_secs,
    s.driver, s.car
  FROM sessions s
  WHERE s.ended_at IS NOT NULL
  ORDER BY s.started_at DESC
  LIMIT p_limit;
$$;
