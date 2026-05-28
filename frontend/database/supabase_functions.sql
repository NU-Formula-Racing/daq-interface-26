-- ============================================================
-- RPC Functions for the NFR26 DAQ Interface
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- get_signal_downsampled: time-bucketed averages for a single signal
-- Used by Graphs page for per-signal plotting
CREATE OR REPLACE FUNCTION get_signal_downsampled(
  p_session_id UUID,
  p_signal_id SMALLINT,
  p_bucket INTERVAL DEFAULT '1 second'
)
RETURNS TABLE (
  bucket TIMESTAMPTZ,
  avg_value DOUBLE PRECISION
) AS $$
DECLARE
  bucket_secs DOUBLE PRECISION;
BEGIN
  bucket_secs := EXTRACT(EPOCH FROM p_bucket);
  RETURN QUERY
  SELECT
    to_timestamp(
      floor(EXTRACT(EPOCH FROM r.timestamp) / bucket_secs) * bucket_secs
    ) AS bucket,
    avg(r.value)::DOUBLE PRECISION AS avg_value
  FROM sd_readings r
  WHERE r.session_id = p_session_id
    AND r.signal_id = p_signal_id
  GROUP BY 1
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- get_session_signals: distinct signals available in a session
-- Used by Graphs page signal panel
CREATE OR REPLACE FUNCTION get_session_signals(p_session_id UUID)
RETURNS TABLE (
  signal_id SMALLINT,
  source TEXT,
  signal_name TEXT,
  unit TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    s.id AS signal_id,
    s.source,
    s.signal_name,
    s.unit
  FROM sd_readings sd
  JOIN signal_definitions s ON s.id = sd.signal_id
  WHERE sd.session_id = p_session_id
  ORDER BY s.source, s.signal_name;
END;
$$ LANGUAGE plpgsql STABLE;


-- get_signal_window: raw data for a signal in a time range
-- Used by Graphs page zoom detail
CREATE OR REPLACE FUNCTION get_signal_window(
  p_session_id UUID,
  p_signal_id SMALLINT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS TABLE (
  "timestamp" TIMESTAMPTZ,
  value DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT r.timestamp, r.value
  FROM sd_readings r
  WHERE r.session_id = p_session_id
    AND r.signal_id = p_signal_id
    AND r.timestamp >= p_start
    AND r.timestamp <= p_end
  ORDER BY r.timestamp;
END;
$$ LANGUAGE plpgsql STABLE;


-- get_session_overview: all signals bucketed for session replay
-- Returns same flat format as old nfr26_signals for widget compatibility
CREATE OR REPLACE FUNCTION get_session_overview(
  p_session_id UUID,
  p_bucket_secs INT DEFAULT 1
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
    to_timestamp(
      floor(extract(epoch FROM r.timestamp) / p_bucket_secs) * p_bucket_secs
    ) AS "timestamp",
    sd.signal_name,
    avg(r.value)::DOUBLE PRECISION AS value,
    sd.unit,
    sd.source
  FROM sd_readings r
  JOIN signal_definitions sd ON sd.id = r.signal_id
  WHERE r.session_id = p_session_id
  GROUP BY 1, sd.signal_name, sd.unit, sd.source
  ORDER BY 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- get_session_signal_ids: distinct signal IDs present in a session.
-- Used by the active-signals sidebar filter on the frontend.
--
-- Bulk readings live as per-source Parquet files in DO Spaces, not in
-- this DB. session_blobs holds one row per uploaded Parquet (one per CAN
-- source per session); joining that to signal_definitions on `source`
-- enumerates which signal_ids the session can serve.
CREATE OR REPLACE FUNCTION get_session_signal_ids(p_session_id UUID)
RETURNS TABLE (signal_id SMALLINT)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT sd.id::SMALLINT AS signal_id
  FROM session_blobs sb
  JOIN signal_definitions sd ON sd.source = sb.source
  WHERE sb.session_id = p_session_id
  ORDER BY sd.id;
$$;


-- list_sessions: paginated session list with derived duration. Drives the
-- session picker (date dropdown). `session_number` is included for clients
-- that prefer the DB-assigned ordinal; clients can also derive an in-day
-- index when the column is NULL.
DROP FUNCTION IF EXISTS list_sessions(integer);

CREATE OR REPLACE FUNCTION list_sessions(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid,
  date date,
  started_at timestamptz,
  ended_at timestamptz,
  duration_secs integer,
  driver text,
  car text,
  session_number integer,
  source text,
  source_file text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.id, s.date, s.started_at, s.ended_at,
    EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::INT AS duration_secs,
    s.driver, s.car, s.session_number, s.source, s.source_file
  FROM sessions s
  WHERE s.ended_at IS NOT NULL
  ORDER BY s.started_at DESC
  LIMIT p_limit;
$$;
