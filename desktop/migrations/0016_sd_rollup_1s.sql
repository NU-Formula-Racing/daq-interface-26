-- 1-second pre-aggregated rollup of sd_readings, populated at import time
-- (or lazily on first replay open for pre-v0.7.4 sessions). Every replay
-- query whose graph bucket is >= 1 s reads this table instead of scanning
-- raw rows — roughly 1000x less random I/O on USB-backed Postgres.
--
-- value_sum (rather than value_avg) is stored so coarser graph buckets can
-- compute the true average across multiple rollup rows exactly:
--   avg = sum(value_sum) / sum(sample_n)
-- min/max compose trivially: min(value_min), max(value_max).

CREATE TABLE sd_rollup_1s (
  session_id  UUID                NOT NULL,
  signal_id   INTEGER             NOT NULL,
  ts_bucket   TIMESTAMPTZ         NOT NULL,
  value_min   DOUBLE PRECISION    NOT NULL,
  value_max   DOUBLE PRECISION    NOT NULL,
  value_sum   DOUBLE PRECISION    NOT NULL,
  sample_n    INTEGER             NOT NULL,
  PRIMARY KEY (session_id, signal_id, ts_bucket)
);

-- Populate (or repopulate) the rollup for one session from raw sd_readings.
-- Safe to call repeatedly: deletes prior rollup rows for the session before
-- inserting. Returns the number of rollup rows written.
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
  RETURN n_rows;
END;
$$;

-- Replace get_signals_window to read from the rollup when the graph bucket
-- is >= 1 s (essentially every replay view). For sub-second buckets — only
-- hit by extreme zoom-ins — fall back to raw sd_readings so per-sample
-- detail is preserved.
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
  -- Rollup path: graph bucket >= 1s. Aggregate pre-grouped 1-second rows.
  -- min-of-mins, max-of-maxes, sum-of-sums / sum-of-ns are exact relative
  -- to the raw samples — no precision loss versus the raw-row aggregate.
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
  WHERE p_bucket_secs >= 1.0
    AND r.session_id = p_session_id
    AND r.signal_id = ANY(p_signal_ids)
    AND r.ts_bucket >= p_start AND r.ts_bucket < p_end
  GROUP BY 1, 2, 3, 4

  UNION ALL

  -- Raw path: sub-second buckets (extreme zoom). Same logic as before.
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
  WHERE p_bucket_secs < 1.0
    AND r.session_id = p_session_id
    AND r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4

  ORDER BY 1;
$$;
