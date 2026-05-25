-- Older versions of the desktop ran pushSessionsToCloud (since deleted) which
-- set sessions.synced_at after writing rows into the OLD Supabase sd_readings
-- table. Those sessions were never uploaded to DO Spaces — manifest_key and
-- content_hash are NULL on every row affected. The new upload flow's local
-- short-circuit (and the Upload All summary endpoint) used to gate on
-- synced_at, which made these rows invisible to the migration.
--
-- Clear the stale flag so they appear as unsynced again. Truly-uploaded rows
-- (the ones that flowed through the Parquet pipeline) all have manifest_key
-- set, so this query leaves them alone.

UPDATE sessions
SET synced_at = NULL,
    uploaded_at = NULL,
    uploaded_by_machine = NULL,
    total_bytes = NULL
WHERE synced_at IS NOT NULL
  AND manifest_key IS NULL;
