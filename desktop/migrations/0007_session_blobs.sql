-- Local-side per-source-group blob tracking. Mirrors the cloud session_blobs
-- table so the desktop knows what it has uploaded (and where), and so the
-- pull flow can stamp the same per-file hashes it verified on download.
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
  ADD COLUMN uploaded_at         TIMESTAMPTZ,
  ADD COLUMN local_deleted_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX sessions_content_hash_idx ON sessions (content_hash)
  WHERE content_hash IS NOT NULL;
