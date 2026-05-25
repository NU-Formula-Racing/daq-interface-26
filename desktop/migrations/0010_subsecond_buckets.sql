-- Allow sub-second bucket sizes in the overview / multi-signal-window RPCs.
-- Previously p_bucket_secs was INT, capping graph granularity at 1 Hz. Now
-- it's DOUBLE PRECISION so callers can pass 0.1 (10 Hz), 0.02 (50 Hz), etc.
--
-- The math is unchanged: floor(epoch / b) * b works the same for any
-- positive real `b`. Existing INT callers still work because PostgreSQL
-- implicitly upcasts INT → DOUBLE PRECISION.

DROP FUNCTION IF EXISTS get_session_overview(UUID, INT);
CREATE OR REPLACE FUNCTION get_session_overview(
  p_session_id  UUID,
  p_bucket_secs DOUBLE PRECISION
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

DROP FUNCTION IF EXISTS get_signals_window(UUID, SMALLINT[], TIMESTAMPTZ, TIMESTAMPTZ, INT);
CREATE OR REPLACE FUNCTION get_signals_window(
  p_session_id   UUID,
  p_signal_ids   SMALLINT[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  DOUBLE PRECISION
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
