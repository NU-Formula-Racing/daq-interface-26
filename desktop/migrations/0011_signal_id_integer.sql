-- signal_definitions.id was SMALLINT (max 32767). Every `INSERT ... ON
-- CONFLICT DO UPDATE` consumes a sequence value even when no row is added,
-- so after enough re-imports with shifting DBC contents the sequence
-- overflows and new inserts fail with:
--   nextval: reached maximum value of sequence "signal_definitions_id_seq"
--
-- Promote signal_definitions.id, sd_readings.signal_id, and
-- rt_readings.signal_id to INTEGER (2.1B headroom). The extra 2 bytes per
-- sd_readings row are negligible (~3 MB per million rows). Then reset the
-- sequence to max(id)+1 so we reclaim the wasted IDs.
--
-- All RPCs that reference SMALLINT in their signatures must be recreated
-- with INTEGER — function signatures don't auto-cast on COLUMN type change.

ALTER TABLE sd_readings ALTER COLUMN signal_id TYPE INTEGER;
ALTER TABLE rt_readings ALTER COLUMN signal_id TYPE INTEGER;
ALTER TABLE signal_definitions ALTER COLUMN id TYPE INTEGER;

-- Reset sequence to start fresh from current max(id).
SELECT setval(
  'signal_definitions_id_seq',
  COALESCE((SELECT MAX(id) FROM signal_definitions), 0) + 1,
  false
);

-- Recreate RPCs with INTEGER in place of SMALLINT.
DROP FUNCTION IF EXISTS get_session_signals(UUID);
CREATE OR REPLACE FUNCTION get_session_signals(p_session_id UUID)
RETURNS TABLE (
  signal_id   INTEGER,
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

DROP FUNCTION IF EXISTS get_signal_window(UUID, SMALLINT, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION get_signal_window(
  p_session_id UUID,
  p_signal_id  INTEGER,
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

DROP FUNCTION IF EXISTS get_signal_downsampled(UUID, SMALLINT, INTERVAL);
CREATE OR REPLACE FUNCTION get_signal_downsampled(
  p_session_id      UUID,
  p_signal_id       INTEGER,
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

DROP FUNCTION IF EXISTS get_session_overview(UUID, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION get_session_overview(
  p_session_id  UUID,
  p_bucket_secs DOUBLE PRECISION
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  signal_id INTEGER,
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

DROP FUNCTION IF EXISTS get_signals_window(UUID, SMALLINT[], TIMESTAMPTZ, TIMESTAMPTZ, DOUBLE PRECISION);
CREATE OR REPLACE FUNCTION get_signals_window(
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
