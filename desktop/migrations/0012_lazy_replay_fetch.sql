-- get_session_signal_ids: distinct signal IDs that have at least one row in
-- sd_readings for a given session. Loose index scan via recursive CTE — see
-- frontend/database/supabase_functions.sql for the cloud equivalent and the
-- rationale (plain SELECT DISTINCT reads every matching row).
--
-- DROP first because the function may exist with a SMALLINT return type from
-- an older install of this work — CREATE OR REPLACE can't change return type.
DROP FUNCTION IF EXISTS get_session_signal_ids(UUID);
CREATE OR REPLACE FUNCTION get_session_signal_ids(p_session_id UUID)
RETURNS TABLE (signal_id INTEGER)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE t AS (
    (
      SELECT r.signal_id
      FROM sd_readings r
      WHERE r.session_id = p_session_id
      ORDER BY r.signal_id
      LIMIT 1
    )
    UNION ALL
    SELECT (
      SELECT r.signal_id
      FROM sd_readings r
      WHERE r.session_id = p_session_id
        AND r.signal_id > t.signal_id
      ORDER BY r.signal_id
      LIMIT 1
    )
    FROM t
    WHERE t.signal_id IS NOT NULL
  )
  SELECT t.signal_id FROM t WHERE t.signal_id IS NOT NULL ORDER BY t.signal_id;
END;
$$;

-- get_signals_window is already using DOUBLE PRECISION for p_bucket_secs and
-- INTEGER for signal_id after migrations 0010 and 0011. Re-declare here to
-- ensure consistency and to confirm the final desired signature.
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

-- get_session_overview and get_signal_downsampled are retired — desktop replay
-- no longer preloads the whole session as bucketed rows. The new lazy fetch
-- path uses get_session_signal_ids + get_signals_window per visible window.
DROP FUNCTION IF EXISTS get_session_overview(UUID, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS get_signal_downsampled(UUID, INTEGER, INTERVAL);
