# Bulk Cloud Migration — Design

**Date:** 2026-05-24
**Status:** Draft for review

## 1. Problem

The cloud move (Parquet on DigitalOcean Spaces + thin metadata catalog on Supabase) is now in place architecturally, but no actual session data lives in the cloud yet. The DO Spaces bucket exists and is empty; Supabase has only schema + signal definitions and 42 stale `sessions` rows from the pre-migration dump.

Meanwhile every historical drive is currently sitting in one of two places: the active embedded Postgres data directory (the user's USB drive) or, for some subset of sessions, only in the pre-migration NDJSON backup at `backups/supabase-pre-parquet/`.

We need a one-shot operation that uploads every existing session into the cloud so that:

- Teammates on other machines can pull a session via the desktop's existing pull flow.
- (Once plan 4 ships) anyone can browse sessions on the website.
- The "one person parses on drive day, everyone else syncs" workflow becomes the steady state.

## 2. Goals

- Move every historical session from local Postgres (and from the NDJSON backup, where local doesn't already have it) into DO Spaces (Parquet files) and Supabase (catalog rows).
- Surface a one-click "Upload all" action in the desktop UI so a non-technical user can run the migration with confidence.
- Re-use the existing per-session upload pipeline. No new server endpoints, no new schemas.
- Make the operation resumable: closing the window mid-run and reopening the next day should pick up where it stopped.
- Detect any sessions that exist only in the NDJSON backup and would otherwise be lost, before they're lost.

## 3. Non-goals

- Building a durable server-side job queue. This is a one-shot operation; per-session idempotency is good enough.
- Auto-upload on session end. Out of scope; a possible follow-up.
- Migrating live (`rt_readings`) data anywhere. Live frames stay in Supabase's `rt_readings`, auto-truncated nightly.
- Website read-path work. The web app still calls dropped RPCs; replacing that is plan 4 (`2026-05-24-web-duckdb-wasm-reads.md`), tracked separately.
- Cross-team merge logic. Push semantics are "local wins" — if two people upload the same drive day from different machines, the second person sees the "already synced" modal and can choose to skip or re-upload. No automatic merge.

## 4. Architecture

Three discrete steps, run in order, each with its own entry point. Steps 1 and 2 are admin scripts (TS, run via `npx tsx`); step 3 is a UI feature that delegates to the existing `/api/cloud/upload/:id` endpoint.

```
 [local Postgres on USB]              [backups/supabase-pre-parquet/]
            \                                       /
             \                                     /
              v                                   v
         (1) compare-backup-vs-local.ts (read-only diff)
                                |
                                v
                  has gap?  yes ->  (2) restore-from-backup.ts (INSERT into local)
                                            |
                                            v
                            local has every session that should be there
                                            |
                                            v
                          (3) "Upload all" UI button  ->  loops POST /api/cloud/upload/:id
                                            |
                                            v
                      DO Spaces (Parquet) + Supabase (catalog rows)
```

The split is intentional: comparing and restoring are diagnostic and rare; uploading is the bulk operation a normal teammate runs. The latter must be a button, not a script.

## 5. Step 1 — Compare USB vs NDJSON backup

### 5.1 Entry point

`desktop/main/scripts/compare-backup-vs-local.ts`. Run as `npx tsx desktop/main/scripts/compare-backup-vs-local.ts`. Reads the active embedded Postgres connection details from the same catalog the desktop uses.

### 5.2 Inputs

- The user's active Postgres data dir (looked up via `loadCatalog(catalogPath)`).
- `backups/supabase-pre-parquet/sessions.ndjson.gz`.
- `backups/supabase-pre-parquet/sd_readings_2026_*.ndjson.gz` — used only to compute which session UUIDs actually have rows.

### 5.3 Output

A printed report grouped into three buckets:

- **Local only** — session UUIDs that exist in local Postgres and don't appear in the backup. These are "fresh" sessions (parsed after the backup was taken) and will be uploaded in step 3.
- **Backup only** — session UUIDs that exist in the backup but not locally. These are at risk; step 2 restores them.
- **Both** — session UUIDs present in both. Local copy wins under push semantics; step 3 will upload the local version.

For each bucket the script prints count + total row estimate. No mutations of any kind.

### 5.4 Edge cases

- A session UUID that exists locally and in backup but with different row counts — flagged as `Both` with a `(local: A rows, backup: B rows)` annotation. User decides whether to investigate or accept local-wins.
- `sessions.ndjson.gz` missing — script exits with a clear "no backup found, nothing to compare; proceed to step 3" message.

## 6. Step 2 — Restore backup-only sessions into local Postgres

### 6.1 Entry point

`desktop/main/scripts/restore-from-backup.ts <session-uuid> [<session-uuid> ...]`. Defaults to all UUIDs reported as "Backup only" by step 1 if no args are given.

### 6.2 Procedure

For each target session UUID, inside a single transaction per session:

1. Upsert `signal_definitions` rows referenced by the session's readings, keyed on `(source, signal_name)`. The local `id` may differ from the cloud `id` that's in the NDJSON; the script must build a `cloud_id -> local_id` map per import.
2. Insert the `sessions` row from `sessions.ndjson.gz`. Use `ON CONFLICT (id) DO NOTHING`; if it already exists locally we shouldn't be here per step 1's classification, but be safe.
3. Stream the relevant `sd_readings_2026_*.ndjson.gz` files, filtering to rows whose `session_id` matches the target. Translate each `signal_id` via the map. COPY-batch insert into local `sd_readings`.
4. Print `restored <session_id>: <row_count> rows`.

If the script fails mid-session, the transaction rolls back — that session is in the same state as before the run, and re-running picks it up cleanly.

### 6.3 Why one transaction per session, not one transaction for the whole run

A bug or signal disconnect should not roll back hours of restore work. Per-session is the granularity that maps to "did this session land or not."

### 6.4 What the script does not do

- It does not write to Supabase or DO Spaces. That is step 3's job. Step 2 only repopulates local Postgres.
- It does not re-decode `.nfr` files. The NDJSON is the canonical source for any backup-only session.

## 7. Step 3 — "Upload all to cloud" UI button

### 7.1 Where it lives

Storage → Local tab, above the existing per-session table. Sits next to the existing "Upload selected" and "Delete local" buttons.

### 7.2 New backend endpoint

One new endpoint: `GET /api/cloud/unsynced-summary` returning:

```json
{
  "count": 47,
  "approxBytes": 1234567890,
  "sessionIds": ["uuid-1", "uuid-2", ...]
}
```

- `count` — number of rows in local `sessions` where `synced_at IS NULL`.
- `approxBytes` — same 32-bytes-per-row rough estimate used by `estimateLocalBytes`, summed across those sessions' `sd_readings`. Confirmation-modal precision only.
- `sessionIds` — the explicit list, in started-at-descending order, that the frontend will iterate. Returning the list here avoids a second round-trip.

### 7.3 Frontend flow

1. The button reads `/api/cloud/unsynced-summary` on render and shows "Upload all (count sessions, ~XXX MB)".
2. Click → modal: *"You're about to upload N sessions to the cloud, approximately XXX MB total. The first run takes a while. Continue?"*
3. On confirm, the frontend iterates `sessionIds` from the same response.
4. For each id, call `POST /api/cloud/upload/:id` and await. After each:
   - Increment a counter shown in the button area ("Uploaded 12 / 47…").
   - Update the table row's status to `Uploaded` / `Already synced` / `Error: …`.
5. Errors don't break the loop. Per-row Retry button is already wired by the existing StorageLocalTab.
6. After the loop finishes, refresh the table and the summary.

### 7.4 Cancellation and resume

- A "Cancel" button appears next to the counter during the loop; clicking it stops after the current session finishes. No partial-session rollback needed — `uploadSession` is already atomic per session.
- Closing the window mid-run is safe. The dedup pre-check in `uploadSession` (Supabase unique index on `content_hash`) silently catches anything that did land in a previous run and marks it synced locally. Re-clicking after a window close resumes from where it left off.

### 7.5 Why frontend-driven and not a server job

A server job would need: state storage, status polling, retry policy, lifecycle on parser restart. For a one-shot operation that happens once per machine, that's more code than the migration is worth. The frontend loop is ~30 lines.

## 8. Error handling

- **Upload failure (network, Spaces 5xx, hash mismatch):** surface in the row's status, leave session marked unsynced, continue to the next. User can retry per row or click "Upload all" again later.
- **Already-synced response (409):** classified as success-by-other-means in the counter. The local `synced_at` field is updated to point at the existing cloud copy.
- **Spaces credentials missing:** all three steps fail at the start with a clear message pointing at Settings → Spaces. Don't begin the loop.
- **Compare/restore scripts on a non-existent backup directory:** print a warning ("nothing to migrate") and exit 0.

## 9. Testing

- **Compare script:** unit test that builds a fake local-PG set and a fake NDJSON file, runs the diff logic, and asserts the three buckets contain the expected UUIDs.
- **Restore script:** integration test against a containerised Postgres. Seed empty local DB + a small synthetic NDJSON file with two sessions; run the script; assert both sessions and their rows landed locally.
- **Upload-all button:** the existing per-session upload tests cover the unit work. Manual verify in dev: upload 3 sessions via the button against MinIO + a test Supabase project; confirm catalog rows + Spaces objects appear; close the window mid-run and re-open; confirm a re-click resumes.

## 10. Rollout plan

1. Land the spec (this doc).
2. Implement step 1 (compare script). Hand it to one teammate to run against their USB; confirm the report makes sense.
3. Run compare against the real USB and inspect the "Backup only" bucket. If empty, skip step 2 entirely.
4. Implement step 2 if needed.
5. Implement step 3 (button + new endpoint).
6. Run step 3 against real Supabase + DO Spaces from one machine. Verify other teammates can pull what was uploaded.
7. Document the workflow in `README.md` (already mostly there — add a one-liner about "Upload all" being the migration trigger).
8. Plan 4 (web reads) is a separate spec/plan; not in this rollout.

## 11. Open questions

None blocking. Possible follow-ups:

- **Auto-upload on session end** — likely worth adding once the migration backlog is empty.
- **Selective restore from backup** — currently restore-from-backup takes UUIDs as arguments; if step 1 ever finds a *huge* "Backup only" bucket, we might want a flag to dedup against `local_deleted_at` so we don't restore sessions the user explicitly deleted locally.
