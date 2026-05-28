-- Live mode no longer creates sessions. All live frames land here.
-- Truncated by the desktop server at America/Chicago midnight (the
-- embedded Postgres has no pg_cron, so cleanup is server-driven).

CREATE TABLE live_today (
  ts         TIMESTAMPTZ NOT NULL,
  signal_id  INTEGER NOT NULL,
  value      DOUBLE PRECISION NOT NULL
);
CREATE INDEX live_today_lookup_idx ON live_today (signal_id, ts);

CREATE OR REPLACE FUNCTION get_live_today_window(
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
  FROM live_today r
  JOIN signal_definitions d ON d.id = r.signal_id
  WHERE r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4
  ORDER BY 1;
$$;
