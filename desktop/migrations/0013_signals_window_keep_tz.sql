-- get_signals_window had `to_timestamp(...) AT TIME ZONE 'UTC'` which strips
-- the timezone from an already-correct timestamptz, producing a tz-naive
-- timestamp. Node-postgres + Fastify then serialize that without a Z, and
-- on a non-UTC client (e.g. CDT) JS Date.parse interprets it as LOCAL time,
-- adding a 5-hour drift to every label in the replay widget.
--
-- Drop the cast — to_timestamp returns timestamptz already, which serializes
-- as proper ISO 8601 with Z.

DROP FUNCTION IF EXISTS get_signals_window(UUID, INTEGER[], TIMESTAMPTZ, TIMESTAMPTZ, DOUBLE PRECISION);

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
    to_timestamp(floor(extract(epoch FROM r.ts) / p_bucket_secs) * p_bucket_secs) AS ts,
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
