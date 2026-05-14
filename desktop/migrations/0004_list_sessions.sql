-- Session list with duration and per-session signal count for the picker.
-- Replaces a paginated select + N count queries with a single RPC.

CREATE OR REPLACE FUNCTION list_sessions(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  date          DATE,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_secs INT,
  driver        TEXT,
  car           TEXT,
  signal_count  INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    s.id, s.date, s.started_at, s.ended_at,
    EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::INT AS duration_secs,
    s.driver, s.car,
    (SELECT count(DISTINCT signal_id)::INT FROM sd_readings
       WHERE session_id = s.id) AS signal_count
  FROM sessions s
  ORDER BY s.started_at DESC
  LIMIT p_limit;
$$;
