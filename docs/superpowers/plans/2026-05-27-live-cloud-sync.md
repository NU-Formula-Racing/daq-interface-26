# Live-Cloud-Sync Implementation Plan

**Goal:** Replicate live sessions to Supabase on a 2 s cadence with a 12 h
rolling retention, surfaced in both the desktop replay picker and the
public website.

**Spec:** `docs/superpowers/specs/2026-05-27-live-cloud-sync-design.md`

---

## Phase 1 — Supabase schema + retention

- [ ] Add `desktop/migrations/cloud/0002_live_tables.sql`:
      - `live_sessions`, `live_readings` (see spec)
      - indexes
      - RLS policies (anon read, service_role write)
      - `pg_cron` extension + hourly retention job (12 h rolling)
- [ ] Apply via `mcp__supabase__apply_migration` to the project.
- [ ] Smoke test: INSERT a live_sessions row + a few live_readings, confirm
      anon SELECT works, INSERT as anon fails.
- [ ] Commit.

## Phase 2 — Desktop ingest worker

- [ ] New file `desktop/main/src/cloud/live-sync.ts`:
      - `class LiveSync`: subscribes to parser event emitter.
      - Buffer (Array<FrameRow>), 2 s flush timer.
      - On `session_started` (live source): wipe prior local live, INSERT
        into Supabase `live_sessions`.
      - On `frames`: push rows.
      - Flush: `supabase.from('live_readings').insert(buffer)`, clear.
      - On `session_ended`: flush + UPDATE ended_at.
- [ ] Wire `LiveSync` into `desktop/main/src/index.ts` after parser is up.
- [ ] Gate on `app_config.liveCloudSync` (boolean, default true).
- [ ] Unit test: feed fake parser events, assert correct Supabase calls.
- [ ] Commit.

## Phase 3 — Desktop picker surfaces local live sessions

The desktop user is the recording user, so live data is already in the
local DB — they don't need to pull from Supabase to view their own. The
cloud-fetch path is a Phase 4 concern (for the website).

- [ ] SessionPicker: stop filtering `source = 'live'` out. Group the
      most-recent live session at the top of the dropdown with a "LIVE"
      badge so it's visually distinct.
- [ ] Add the live session's `started_at` to its row label.
- [ ] Commit.

## Phase 4 — Website + cloud live picker

This is where Supabase-direct reads come in.

- [ ] New `frontend/interface` hooks: `useLiveSessionsCloud`,
      `useLiveReplayFrames` — call the Supabase RPCs (`get_live_signals_window`)
      with the bundled anon creds.
- [ ] Website session picker: "LIVE TODAY" group at the top, sourced from
      Supabase.
- [ ] Reuse the existing replay layout but feed it from the cloud-backed
      frames store.
- [ ] Confirm bundled anon creds reach the new tables.
- [ ] Commit.

## Phase 5 — UX polish

- [ ] Visual marker (pulse dot + "LIVE" label) on the picker row.
- [ ] In the live session detail, show "auto-deleted at HH:MM" countdown.
- [ ] Commit.

---

## Open follow-ups (post-merge)

- Reconsider retention if Supabase row counts exceed free-tier headroom
  after the upgrade.
- Consider websocket fan-out for sub-2-second latency to viewers.
