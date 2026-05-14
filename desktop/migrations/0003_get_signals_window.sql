-- Multi-signal bucketed window with envelope (min/max/avg) and signal-name join.
-- One round-trip replaces N parallel get_signal_downsampled calls.
-- Uses epoch-floor bucketing since timescaledb's time_bucket isn't installed.

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
