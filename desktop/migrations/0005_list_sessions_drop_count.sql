-- list_sessions originally included signal_count via a per-row subquery on
-- sd_readings. With ~50 sessions and 1.9M rows, that times out (>30s) even
-- with the (session_id, signal_id, ts) index. Drop signal_count for now —
-- the picker doesn't strictly need it. Re-introduce later via a denormalized
-- column on `sessions` or a precomputed materialized view.

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
