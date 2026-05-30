-- populate_sd_rollup now runs ANALYZE on sd_rollup_1s after the insert so
-- the planner sees stats reflecting the freshly-inserted rows. Without
-- this, a single-session populate during a fresh batch import could
-- leave stats stale for that session's data, and subsequent /signals/window
-- queries would fall back to seq scans.

CREATE OR REPLACE FUNCTION populate_sd_rollup(p_session_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  n_rows INTEGER;
BEGIN
  DELETE FROM sd_rollup_1s WHERE session_id = p_session_id;
  INSERT INTO sd_rollup_1s (session_id, signal_id, ts_bucket,
                            value_min, value_max, value_sum, sample_n)
  SELECT
    r.session_id,
    r.signal_id,
    date_trunc('second', r.ts) AS ts_bucket,
    min(r.value)               AS value_min,
    max(r.value)               AS value_max,
    sum(r.value)               AS value_sum,
    count(*)::INT              AS sample_n
  FROM sd_readings r
  WHERE r.session_id = p_session_id
  GROUP BY r.session_id, r.signal_id, ts_bucket;
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  ANALYZE sd_rollup_1s;
  RETURN n_rows;
END;
$$;
