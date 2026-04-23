CREATE OR REPLACE FUNCTION get_session_signals(p_session_id UUID)
RETURNS TABLE (
  signal_id   SMALLINT,
  source      TEXT,
  signal_name TEXT,
  unit        TEXT
)
LANGUAGE SQL STABLE AS $$
  SELECT DISTINCT
    sr.signal_id,
    sd.source,
    sd.signal_name,
    sd.unit
  FROM sd_readings sr
  JOIN signal_definitions sd ON sd.id = sr.signal_id
  WHERE sr.session_id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION get_signal_window(
  p_session_id UUID,
  p_signal_id  SMALLINT,
  p_start      TIMESTAMPTZ,
  p_end        TIMESTAMPTZ
)
RETURNS TABLE (
  ts    TIMESTAMPTZ,
  value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT ts, value
  FROM sd_readings
  WHERE session_id = p_session_id
    AND signal_id  = p_signal_id
    AND ts >= p_start
    AND ts <= p_end
  ORDER BY ts;
$$;

CREATE OR REPLACE FUNCTION get_signal_downsampled(
  p_session_id     UUID,
  p_signal_id      SMALLINT,
  p_bucket_interval INTERVAL
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  avg_value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(
      floor(extract(epoch FROM ts) / extract(epoch FROM p_bucket_interval))
      * extract(epoch FROM p_bucket_interval)
    ) AS bucket,
    avg(value) AS avg_value
  FROM sd_readings
  WHERE session_id = p_session_id
    AND signal_id  = p_signal_id
  GROUP BY bucket
  ORDER BY bucket;
$$;

CREATE OR REPLACE FUNCTION get_session_overview(
  p_session_id UUID,
  p_bucket_secs INT
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  signal_id SMALLINT,
  avg_value DOUBLE PRECISION
)
LANGUAGE SQL STABLE AS $$
  SELECT
    to_timestamp(floor(extract(epoch FROM ts) / p_bucket_secs) * p_bucket_secs) AS bucket,
    signal_id,
    avg(value) AS avg_value
  FROM sd_readings
  WHERE session_id = p_session_id
  GROUP BY bucket, signal_id
  ORDER BY bucket, signal_id;
$$;
