-- Content hash of the imported source file. NULL for live sessions.
-- A UNIQUE constraint treats NULLs as distinct (Postgres default), so live
-- sessions are not affected. Imports with the same byte-identical source
-- file conflict on this column, which is how we dedup re-imports of the
-- same .bin across machines.
ALTER TABLE sessions ADD COLUMN source_file_hash TEXT;
ALTER TABLE sessions ADD CONSTRAINT sessions_source_file_hash_key UNIQUE (source_file_hash);
