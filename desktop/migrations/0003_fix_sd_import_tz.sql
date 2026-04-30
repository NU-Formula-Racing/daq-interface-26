-- One-time fix for SD imports created before v0.3.9.
--
-- The .nfr reader used to tag the car's RTC wall-clock as UTC, but the RTC
-- is actually Chicago local time. So a 14:00 CDT recording got stored as
-- 14:00 UTC and rendered back as 09:00 CDT in the UI — every old session is
-- shifted 5–6h earlier than reality.
--
-- Fix: take the stored wall-clock, reinterpret it as America/Chicago, and
-- store the resulting UTC. Idempotent in practice because schema_migrations
-- ensures it only runs once per database; new imports on v0.3.9+ already
-- store correct UTC and won't be touched after this migration runs.
UPDATE sd_readings
SET ts = (ts AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'
WHERE session_id IN (SELECT id FROM sessions WHERE source = 'sd_import');

UPDATE sessions
SET started_at = (started_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago',
    ended_at   = CASE WHEN ended_at IS NULL THEN NULL
                      ELSE (ended_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'
                 END
WHERE source = 'sd_import';

-- Recompute the date column from the corrected started_at, in UTC, so the
-- result doesn't depend on whatever timezone the server session happens to
-- be in.
UPDATE sessions
SET date = (started_at AT TIME ZONE 'UTC')::date
WHERE source = 'sd_import';
