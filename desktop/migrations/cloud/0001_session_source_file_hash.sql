-- Apply to the cloud (Supabase) `sessions` table once, manually.
-- Mirrors the local 0006 migration.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source_file_hash TEXT;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_source_file_hash_key;
ALTER TABLE sessions ADD CONSTRAINT sessions_source_file_hash_key UNIQUE (source_file_hash);
