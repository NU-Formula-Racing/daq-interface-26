-- Sidebar/replay needs to know which signals have data in a given live
-- session. Same shape as get_session_signal_ids but reads live_readings.

CREATE OR REPLACE FUNCTION get_live_session_signal_ids(p_session_id UUID)
RETURNS TABLE (signal_id INTEGER)
LANGUAGE SQL STABLE AS $$
  SELECT DISTINCT r.signal_id FROM live_readings r WHERE r.session_id = p_session_id
$$;
