# Cloud Pull + Parquet Storage + CSV Export — Design

**Date:** 2026-05-24
**Status:** Draft for review

## 1. Problem

The current cloud sync layer has two issues:

1. **One-way sync only.** The desktop app can push sessions to Supabase Postgres, but cannot pull sessions ingested by other users. There is no path for a teammate on a different machine to load a session that someone else recorded.
2. **Cloud storage cost is unsustainable.** A single drive-day of CAN telemetry, stored as rows in Supabase Postgres (`sd_readings`), is roughly 3 GB — Supabase's free tier is 500 MB. The data has already had to be deleted manually. The row-oriented Postgres layout, combined with composite indexes and partition overhead, is the wrong shape for high-frequency time-series telemetry that is written once and read in whole-session bulk.

Separately, users have asked for a human-readable export format and for the desktop app to be able to ingest CSVs (not just `.nfr` binary files).

## 2. Goals

- Cut cloud storage footprint by ~20–50× by moving session row data out of Postgres into compressed columnar files in object storage.
- Add a cloud → desktop pull flow so any teammate with credentials can fetch a session and view it locally.
- Give users explicit, manual control over upload, pull, and local-delete operations, with size warnings and dedup safeguards.
- Fix the current sync bug where a session is marked "synced" before upload success is verified.
- Add long-form CSV export from both the desktop app and the web app, and add a CSV import path on the desktop.

## 3. Non-goals

- Cross-session ad-hoc querying in the cloud (filter-by-signal across many sessions). Sessions are always read whole.
- Automatic upload on session completion. Uploads are user-initiated.
- Automatic local cache eviction. Users manage local disk usage by selecting days to delete.
- A web upload path. Uploads happen from desktop only.
- Wide-format CSV export. Only long format is supported.
- Generic CSV viewer for arbitrary CSVs. Imported CSVs must match the long-form schema this app exports.

## 4. Architecture

Three stores, three roles:

- **DigitalOcean Spaces** (S3-compatible object storage) — durable archive for session row data. One folder per session, one Parquet file per CAN message source, plus a `manifest.json`. Files are immutable once uploaded.
- **Supabase Postgres** — thin catalog only. Holds `sessions`, `signal_definitions`, and a new `session_blobs` table mapping sessions to their object keys. Does **not** hold per-sample row data. The existing `sd_readings` table and all its monthly partitions are dropped from Supabase. `rt_readings` (live realtime ingest) is unchanged.
- **Local embedded Postgres** (inside the desktop app) — schema unchanged. When the user pulls a session from the cloud, rows are inserted into the existing `sd_readings` table so that every existing chart, RPC, and replay path works without modification.

### 4.1 Why Parquet on object storage

The intuition the user described — "row-column grouped database, grouped by message id with individual signal names underneath" — maps directly onto Parquet's row-group + column-chunk layout. With ZSTD compression:

- The `signal_id` column dictionary-encodes to near-zero overhead (a handful of distinct IDs repeated millions of times).
- The `timestamp` column delta-encodes (monotonically increasing within a source).
- The `value` column compresses well for the smooth, correlated physical signals typical of vehicle telemetry.

The expected reduction vs current row-oriented Postgres storage is 20–50×, taking a 3 GB day down to roughly 60–150 MB. DigitalOcean Spaces is $5/month flat for 250 GB storage + 1 TB egress, which the GitHub Student Pack credit covers for years.

### 4.2 Why DuckDB on the read side

DuckDB is a single-binary, embeddable analytical engine that reads Parquet natively and exposes a Postgres-compatible SQL surface. On the desktop, it is used as a one-shot reader during the pull-and-import step: open Parquet → SELECT rows → COPY into local Postgres. It is not a persistent runtime dependency for live or replay queries.

## 5. Data formats

### 5.1 Parquet file layout

One file per session per CAN message source. Object key pattern:

```
sessions/<session_id>/<source>.parquet
sessions/<session_id>/manifest.json
```

Per-file schema:

| Column | Type | Notes |
|---|---|---|
| `timestamp` | `TIMESTAMP(MICROS, UTC)` | Microsecond precision, UTC |
| `signal_id` | `INT16` | Matches `signal_definitions.id` |
| `value` | `DOUBLE` | |

Writer settings:

- Compression: ZSTD level 3
- Row group target: 128 MB uncompressed
- Sort order within row groups: `(signal_id, timestamp)` — improves dictionary efficiency and supports per-signal scans during import

### 5.2 Manifest

`manifest.json` is uploaded alongside the Parquet files and is the source of truth for what files belong to a session:

```json
{
  "session_id": "uuid",
  "manifest_version": 1,
  "created_at": "ISO-8601",
  "files": [
    {
      "source": "PDM",
      "object_key": "sessions/<session_id>/PDM.parquet",
      "bytes": 12345678,
      "row_count": 1000000,
      "sha256": "hex..."
    }
  ],
  "session_content_hash": "hex..."
}
```

`session_content_hash` is the SHA-256 of the lexicographically sorted, concatenated per-file SHA-256s. It is the cross-machine dedup key.

### 5.3 CSV format (long)

Single header row, followed by one row per sample:

```
timestamp,source,signal_name,value
2026-04-21T15:32:01.123456Z,BMS_SOE,Battery_Voltage,392.4
```

`timestamp` is ISO-8601 UTC with microsecond precision. The same format is used for both export and import. The CSV importer detects this format by the exact header line.

## 6. Catalog schema changes (Supabase)

### 6.1 New table

```sql
CREATE TABLE session_blobs (
  session_id    UUID    NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source        TEXT    NOT NULL,
  object_key    TEXT    NOT NULL,
  bytes         BIGINT  NOT NULL,
  row_count     BIGINT  NOT NULL,
  content_hash  TEXT    NOT NULL,  -- per-file SHA-256
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, source)
);

CREATE INDEX session_blobs_content_hash_idx ON session_blobs (content_hash);
```

### 6.2 `sessions` additions

```sql
ALTER TABLE sessions
  ADD COLUMN content_hash       TEXT,         -- session_content_hash from manifest
  ADD COLUMN manifest_key       TEXT,         -- object key of manifest.json
  ADD COLUMN total_bytes        BIGINT,       -- sum of session_blobs.bytes
  ADD COLUMN uploaded_by_machine TEXT,        -- desktop machine identifier (already exists in some form; reconcile)
  ADD COLUMN uploaded_at        TIMESTAMPTZ;

CREATE UNIQUE INDEX sessions_content_hash_idx ON sessions (content_hash)
  WHERE content_hash IS NOT NULL;
```

The unique index on `content_hash` enforces cross-machine dedup at the database level — a duplicate insert fails fast and the desktop surfaces the "already synced" modal.

### 6.3 Dropped objects

`sd_readings` and all its monthly partitions are dropped. The existing RPC functions that read `sd_readings` (`get_signal_downsampled`, `get_session_signals`, `get_signal_window`, `get_session_overview`, `get_session_signal_ids`) are also dropped from Supabase — they only make sense against local Postgres now, where they already exist.

The website's session-loading path changes from "call RPC" to "list session_blobs → fetch Parquet from Spaces → read in browser via duckdb-wasm." That migration is in scope for the web app changes below.

## 7. Upload flow (desktop, manual)

Triggered from the Storage screen when the user selects one or more sessions and clicks **Upload to cloud**. For each selected session, in series:

1. **Build Parquet files.** Stream rows out of local Postgres, partitioned by `source`, into temp Parquet files in the OS temp dir. Compute per-file SHA-256 as bytes are written.
2. **Build manifest.** Write `manifest.json` with file list, byte sizes, row counts, per-file hashes, and the derived `session_content_hash`.
3. **Dedup pre-check.** SELECT from Supabase `sessions` WHERE `content_hash = ?`. If a row exists:
   - Show modal: *"This session was already synced from `<uploaded_by_machine>` on `<uploaded_at>`. Skip / Re-upload anyway?"*
   - On Skip, mark the local session as synced (pointing at the existing cloud copy) and continue to the next session.
   - On Re-upload anyway, proceed with steps 4–6 below, but skip step 7's INSERT and instead UPDATE the existing `sessions` row.
4. **Upload files.** Multipart PUT each Parquet to DO Spaces, then the manifest. Use `Content-MD5` headers so Spaces will reject corrupted uploads server-side.
5. **Verify each file.** After each upload, issue a HEAD request and confirm `Content-Length` matches the local byte count. Then GET the first and last 16 KB and confirm those bytes match — a cheap probe that catches the "200 OK but body truncated" failure mode without re-downloading the whole file.
6. **Verify manifest can be read back.** GET the manifest.json and confirm it parses and matches the locally computed hash.
7. **Commit to catalog (transactional).** In a single Supabase transaction:
   - INSERT into `sessions` with `content_hash`, `manifest_key`, `total_bytes`, `uploaded_at`, `uploaded_by_machine`.
   - INSERT rows into `session_blobs` for each file.
   - On unique-constraint violation on `content_hash`, fall back to the "already synced" path.
8. **Mark local session synced.** Only after step 7 commits successfully, update the local Postgres `sessions` row's `synced_at` field.

Any failure in steps 1–7 leaves the local session marked **unsynced** and surfaces an error inline on the row with a **Retry** button. The retry resumes from step 1 — Parquet generation is deterministic, so the content hashes will be identical and dedup will catch any uploads that actually completed on a previous attempt.

This sequencing fixes the existing bug (per commit ee4ca70) where the local "synced" flag was being set based on the upload call returning, without confirming the bytes actually landed.

## 8. Pull flow (desktop, manual)

Triggered from the Storage screen's **Cloud** tab.

1. Desktop queries Supabase: `SELECT id, date, total_bytes FROM sessions WHERE id NOT IN (<local session ids>) ORDER BY date DESC`.
2. UI groups by day and shows total bytes per day.
3. User multi-selects days (or individual sessions) and clicks **Pull selected**.
4. Modal: *"This will download N sessions, ~XXX MB total, and import them into your local database. Continue?"*
5. For each session, in series:
   - GET the manifest from Spaces. Verify it matches the catalog `content_hash`.
   - For each file in the manifest: GET to a temp path, verify SHA-256 matches.
   - Open a transaction in local Postgres. INSERT the `sessions` row. For each Parquet file: open via DuckDB and `INSERT INTO sd_readings SELECT timestamp, '<session_id>', signal_id, value FROM parquet_scan('<temp>')`. Commit.
   - Delete temp Parquet files.
   - Update progress UI.
6. On any failure mid-session, rollback the local transaction so partial sessions never appear. Surface a per-session error with **Retry**.

## 9. Local delete flow (desktop)

On the Storage screen's **Local** tab, multi-select by day → **Delete local copy**.

- Confirmation modal: *"This will free ~XXX MB of disk space. The cloud copy is untouched. You can re-pull these sessions any time."*
- On confirm: `DELETE FROM sd_readings WHERE session_id IN (...)` followed by `VACUUM`. Local `sessions` row is kept but marked `local_deleted_at = now()`; the session moves to the Cloud tab.

## 10. CSV export

### 10.1 Desktop

- **Where:** A new "Export CSV" button on the session view, next to existing export controls.
- **Behavior:** Opens a native save dialog. Streams rows out of local Postgres in `(timestamp, signal_id)` order, joining against `signal_definitions` to produce the long-form columns, and writes to disk. No progress modal needed for typical session sizes; for very large sessions a non-blocking toast with a cancel button.

### 10.2 Web app

- **Where:** Same button placement on the web session view.
- **Behavior:** The web app already loads session data through DuckDB-wasm against Parquet files. Export runs a DuckDB COPY-to-CSV in the browser and triggers a browser download.

Both exports produce byte-identical files for the same session.

## 11. CSV import (desktop)

- **Where:** New "Import CSV" option in the existing import menu alongside `.nfr` import.
- **Detection:** The importer reads only the first line. If it exactly matches `timestamp,source,signal_name,value`, treat as a long-form telemetry CSV; otherwise reject with an explanatory error.
- **Pipeline:** Parse rows, resolve `(source, signal_name)` → `signal_id` via `signal_definitions` (inserting new definitions as needed, same as the `.nfr` path), create a new `sessions` row, COPY rows into `sd_readings`. The new session then behaves identically to any other.
- **No** schema fuzzing, no header reordering, no auto-mapping. If users want to import arbitrary CSVs from other tools, that is a future feature.

## 12. Migration plan

A single Supabase migration:

1. `DROP TABLE sd_readings CASCADE;` (also drops monthly partitions and dependent RPCs).
2. Drop the legacy `nfr26_signals` table mentioned in `frontend/database/info.md` — it is already unused.
3. `CREATE TABLE session_blobs ...`
4. `ALTER TABLE sessions ADD COLUMN ...`
5. Drop the dependent RPC functions listed in §6.3.

A separate local-side migration on the desktop app clears the `synced_at` field on any locally-stored session, since the prior sync semantics were unsound. Users re-upload at their own pace.

The web app is updated in the same release to read sessions via DuckDB-wasm + Parquet instead of the dropped RPCs.

## 13. Configuration and credentials

DO Spaces access key, secret key, region, bucket name, and endpoint URL are stored in the desktop app's existing config layer (same place as Supabase service-role key today). The web app does **not** need Spaces credentials for reads if the bucket is configured with a public-read ACL on `sessions/*` — recommended, since session data is non-sensitive within the team. If reads need to be authenticated, the desktop generates per-session pre-signed GET URLs and stores them in the catalog; this is a follow-up if needed.

## 14. Testing

- **Unit (parser/desktop):** Parquet round-trip — given a synthetic set of `sd_readings` rows, write to Parquet, read back via DuckDB, COPY into a fresh local Postgres, assert row-for-row equality (timestamp, signal_id, value).
- **Unit (CSV):** Export then import a session, assert row-for-row equality.
- **Integration (sync):** Stand up a MinIO container (S3-compatible) in CI. Run the full upload flow including injected failures — network drop mid-PUT, HEAD returns wrong byte count, hash mismatch on verification. Assert the local session is never marked synced unless the catalog row landed.
- **Integration (dedup):** Run the upload flow twice against MinIO. Assert the second run hits the "already synced" path and does not re-upload bytes.
- **Manual end-to-end:** Upload a real session to DO Spaces from one machine, pull it on a second machine, confirm the resulting `sd_readings` row counts and a checksum of `(timestamp, signal_id, value)` match.
- **Manual web:** Open the same session in the web app, confirm a chart renders correctly, export to CSV, diff against the desktop CSV export.

## 15. Open questions

None blocking. Possible follow-ups, explicitly deferred:

- Per-session pre-signed URLs vs public-read bucket.
- Background queued upload (vs strictly synchronous manual).
- Wide-format CSV export with downsampling.
- Generic CSV viewer for foreign formats.
- Cross-session cloud queries.
