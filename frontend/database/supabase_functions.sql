-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New Query)
--
-- This function aggregates signal data into time buckets server-side,
-- so the frontend only receives hundreds of points instead of thousands.
-- For each (bucket, signal), it returns the average, min, and max value.

CREATE OR REPLACE FUNCTION get_session_bucketed(
  p_session_id INT,
  p_bucket_ms INT DEFAULT 1000
)
RETURNS TABLE (
  bucket_time TIMESTAMPTZ,
  signal_name TEXT,
  avg_value DOUBLE PRECISION,
  min_value DOUBLE PRECISION,
  max_value DOUBLE PRECISION,
  unit TEXT,
  source TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    to_timestamp(
      floor(extract(epoch FROM s.timestamp) * 1000 / p_bucket_ms) * p_bucket_ms / 1000
    ) AS bucket_time,
    s.signal_name,
    avg(s.value)::DOUBLE PRECISION AS avg_value,
    min(s.value)::DOUBLE PRECISION AS min_value,
    max(s.value)::DOUBLE PRECISION AS max_value,
    max(s.unit) AS unit,
    max(s.source) AS source
  FROM nfr26_signals s
  WHERE s.session_id = p_session_id
  GROUP BY bucket_time, s.signal_name
  ORDER BY bucket_time;
END;
$$ LANGUAGE plpgsql;


-- This function returns raw (un-aggregated) signals within a time window.
-- Used for zoom-in detail when the user selects a small time range.

CREATE OR REPLACE FUNCTION get_session_window(
  p_session_id INT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  "timestamp" TIMESTAMPTZ,
  signal_name TEXT,
  value DOUBLE PRECISION,
  unit TEXT,
  source TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.timestamp,
    s.signal_name,
    s.value::DOUBLE PRECISION,
    s.unit,
    s.source
  FROM nfr26_signals s
  WHERE s.session_id = p_session_id
    AND s.timestamp >= p_start
    AND s.timestamp <= p_end
  ORDER BY s.timestamp;
END;
$$ LANGUAGE plpgsql;
