-- Cloud schema transition: row-oriented session storage moves out of Postgres
-- and into object storage as Parquet. This migration drops the row tables and
-- their dependent RPCs, and replaces them with a thin per-session blob catalog.

-- Drop the legacy table mentioned in frontend/database/info.md -- unused for
-- a while but never removed.
DROP TABLE IF EXISTS nfr26_signals CASCADE;

-- Drop the per-sample row store and all its monthly partitions. Cascades the
-- RPCs that depend on it (get_signal_downsampled, get_session_signals,
-- get_signal_window, get_session_overview, get_session_signal_ids).
DROP TABLE IF EXISTS sd_readings CASCADE;

-- Per-source-group blob catalog. One row per Parquet file uploaded to DO
-- Spaces. session_content_hash on sessions enforces cross-machine dedup.
CREATE TABLE session_blobs (
  session_id    UUID    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL,
  object_key    TEXT    NOT NULL,
  bytes         BIGINT  NOT NULL,
  row_count     BIGINT  NOT NULL,
  content_hash  TEXT    NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, source)
);

CREATE INDEX session_blobs_content_hash_idx ON session_blobs (content_hash);

ALTER TABLE sessions
  ADD COLUMN content_hash        TEXT,
  ADD COLUMN manifest_key        TEXT,
  ADD COLUMN total_bytes         BIGINT,
  ADD COLUMN uploaded_by_machine TEXT,
  ADD COLUMN uploaded_at         TIMESTAMPTZ;

CREATE UNIQUE INDEX sessions_content_hash_idx ON sessions (content_hash)
  WHERE content_hash IS NOT NULL;
