# Website parity with desktop app + Spaces verification

**Date:** 2026-05-26
**Scope:** `frontend/interface/` (the public Vite website at nfrinterface.com) only.
**Out of scope:** any change under `app/`, `desktop/`, `parser/`, `packages/widgets/` source.

## Goal

Bring the public website's `/app` route into behavioral and visual parity with
the desktop app for the parts that overlap (replay, session picker, signal
filtering), verify the DigitalOcean Spaces data path is healthy, and fix the
broken active-signal filter.

## Background

- The website (`frontend/interface/`) shares widget code with the desktop app
  via the `@nfr/widgets` workspace package, so most widget-level fixes
  propagate automatically.
- Replay/session adapters are **forked**: desktop uses REST against its local
  Fastify server (`app/src/hooks/useReplayFrames.ts`), website uses Supabase
  RPCs (`frontend/interface/src/adapters/useSupabaseFrames.ts`).
- Bulk per-signal data lives in DO Spaces as Parquet. The website does not
  fetch Parquet directly; it reads aggregated buckets via the Supabase
  `get_signals_window` RPC.

## Problems to fix

1. **Sub-second buckets don't propagate to the website.** Desktop
   (`app/src/hooks/useReplayFrames.ts` line 102) computes
   `bucketSecs = durationSecs / TARGET_BUCKETS` with no rounding. Website
   (`frontend/interface/src/adapters/useSupabaseFrames.ts` lines 63–65)
   computes `Math.max(1, Math.round(...))` for `durationSecs` and then calls
   `bucketFor(...)`, which floors to whole seconds. Short zoom windows render
   as coarse, stair-step lines on the website.

2. **Active-signal filter is broken on the website.** AppRoute passes
   `availableSignalIds` from `useSessionSignalIds` (a `Set<number>`) into the
   `DockDirection` widget. Desktop does the same and it works. Root cause is
   one of: stale widget bundle on the website, a divergent status enum
   between the two hooks, or a Set-vs-array mismatch.

3. **Session picker is a flat dropdown numbered `#1 · 14:23:00 · 320s`.**
   Desktop uses a calendar grid → click date → list of sessions labeled by
   local time and short id. The user wants the website to match desktop
   exactly.

4. **Spaces connectivity has never been verified from the website's origin.**
   Even though the website doesn't fetch Parquet directly, we need
   confidence the published `cloud-defaults.json` URL is reachable and the
   data is actually populated in Supabase for sessions whose Parquet exists
   in Spaces.

## Design

### 1. Spaces & data-pipeline verification (diagnostic only)

Read-only sanity checks; no production code added unless something fails.

- Read `desktop/build/cloud-defaults.json` to learn canonical
  `spacesPublicBase`, `supabaseUrl`.
- From a browser tab on the website's origin (or `curl`): `HEAD` a known
  manifest URL `<spacesPublicBase>/sessions/<id>/manifest.json`. Pass = bucket
  reachable + CORS open for the website origin.
- Open the website `/app?session=<id>` for a session known to exist in Spaces;
  confirm `get_signals_window` returns rows. Pass = pipeline healthy via
  Supabase, no Spaces work needed.
- If any check fails, surface the gap and stop. Fixes for desktop or DB are
  out of scope per user instruction.

### 2. Fix active-signal filter

Trace the contract end-to-end:

- Read `packages/widgets/src/dock/...` (read-only) to learn whether
  `availableSignalIds` is expected as `Set<number>` or `number[]` and which
  call sites use it.
- Compare website `useSessionSignalIds` return shape and `status` enum to
  desktop's.
- Apply the minimum diff on the website side. Most likely fix:
  - rebuild/reinstall `@nfr/widgets` so the website has the same bundle as
    desktop, **or**
  - normalize the Set/array at the AppRoute boundary, **or**
  - align the `status` string enum so the gating `idsStatus === 'ready'`
    actually trips.

Verification: open `/app?session=<id>`, open any widget signal picker, confirm
signals not present in the session are hidden.

### 3. Sub-second bucket parity

In `frontend/interface/src/adapters/useSupabaseFrames.ts`:

- Replace
  ```ts
  const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
  const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);
  ```
  with
  ```ts
  const durationSecs = Math.max(0.001, (endMs - startMs) / 1000);
  const bucketSecs = durationSecs / (args.targetBuckets ?? 800);
  ```
- Drop `bucketFor` import if it's no longer used anywhere; keep the file and
  its tests if `bucketFor` has other callers.
- Update `FramesCache.recordFetch` / `missing` key handling only if it
  rounds the `bucketSecs` parameter (it shouldn't — but verify).

Verification: zoom the graph to a 5-second window on the website; confirm
samples are dense like desktop, not stepped.

### 4. Desktop-style session picker

Create `frontend/interface/src/components/SessionPicker.jsx` by porting
`app/src/components/SessionPicker.tsx` to JSX:

- Calendar grid with `‹ TODAY ›` controls. Days with sessions are highlighted
  and badge-counted; days without are disabled.
- Click a date → day-list panel: each row shows
  `new Date(s.started_at).toLocaleTimeString()` on the left and
  `s.source_file?.split('/').slice(-1)[0] ?? s.id.slice(0,8)` on the right.
- No `#N` numbering, no `Ns` duration in the row label.
- Trigger button label = `${new Date(current.started_at).toLocaleDateString()} · ${currentId.slice(0,8)}`.

Wiring:
- Source sessions from existing `useSessionList()` (Supabase RPC
  `list_sessions`) — do not introduce a new fetch path.
- Filter to `s.source === 'sd_import'` like desktop does.
  (If `useSessionList` rows don't currently carry `source`, extend the
  `SessionListItem` interface and the RPC selection rather than dropping the
  filter.)
- Replace `<DateAndSessionPicker .../>` in `routes/AppRoute.jsx` with
  `<SessionPicker .../>`. Preserve `?session=`, `?date=` URL params: on pick,
  call `setSearch` exactly as today.

Remove `DateAndSessionPicker.jsx` and `DatePicker.jsx`/`DatePicker.css` only if
no other component still imports them — otherwise leave them in place.

### 5. Widget-parity audit

- Check `frontend/interface/package.json` resolves `@nfr/widgets` from the
  workspace (`packages/widgets`).
- If `packages/widgets` has a `dist/` build step, rebuild it once so both
  consumers run the same compiled code. If Vite imports source directly, no
  action.
- Eyeball-test the website `/app` route against the desktop screenshots for:
  cursor snap, x-axis anchor to session start, enum signal name rendering,
  reset-zoom button, data-status dot, min/max band toggle. File a follow-up
  task for anything that still differs.

## Non-goals

- No browser-side Parquet/Spaces fetch path.
- No changes to RPCs, migrations, or DB schema.
- No marketing-page (`/`, `/app-download`) redesign.
- No new features — only parity and bug fixes.

## Verification checklist

- [ ] Spaces public base URL responds to HEAD for a known manifest.
- [ ] `/app?session=<known-id>` renders data on the website.
- [ ] Signal picker on the website hides signals not in the current session.
- [ ] 5-second zoom on the website looks as dense as desktop.
- [ ] Session picker on the website is a calendar grid matching desktop UX.
- [ ] No `app/`, `desktop/`, `parser/`, or `packages/widgets/` source files
      modified.
