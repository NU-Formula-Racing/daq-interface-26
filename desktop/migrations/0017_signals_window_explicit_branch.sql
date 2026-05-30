-- Replace the UNION-ALL form of get_signals_window from migration 0016
-- with an explicit PL/pgSQL branch. The previous version relied on the
-- planner constant-folding `WHERE p_bucket_secs >= 1.0` vs `< 1.0` to
-- prune one side of the UNION, but for parameterized SQL functions
-- Postgres often still plans (and partly executes) both branches —
-- the raw-sd_readings branch then does the index seek it was supposed
-- to skip, costing ~1s on USB-backed disks even when it returns no rows.
--
-- An explicit IF avoids the issue: only the chosen branch is ever
-- planned for a given call. We pay a fresh plan per invocation, but
-- the savings from never touching sd_readings in the hot path dwarf
-- that overhead.

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
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_bucket_secs >= 1.0 THEN
    RETURN QUERY
      SELECT
        to_timestamp(floor(extract(epoch FROM r.ts_bucket) / p_bucket_secs) * p_bucket_secs) AS ts,
        r.signal_id,
        d.signal_name,
        d.unit,
        min(r.value_min)                       AS value_min,
        max(r.value_max)                       AS value_max,
        sum(r.value_sum) / sum(r.sample_n)     AS value_avg,
        sum(r.sample_n)::INT                   AS sample_n
      FROM sd_rollup_1s r
      JOIN signal_definitions d ON d.id = r.signal_id
      WHERE r.session_id = p_session_id
        AND r.signal_id = ANY(p_signal_ids)
        AND r.ts_bucket >= p_start AND r.ts_bucket < p_end
      GROUP BY 1, 2, 3, 4
      ORDER BY 1;
  ELSE
    RETURN QUERY
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
  END IF;
END;
$$;
