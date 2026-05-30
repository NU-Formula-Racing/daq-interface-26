# NFR 26 DAQ Interface

This is the data tool for NFR 26. It records CAN data off the car, stores it, and shows it to you in a dashboard. You can run it live or open old sessions later.

The repo is split into a few folders. Here is what each one does.

## app/

This is the frontend. It is a React app made with Vite. Everything you see in the window (graphs, gauges, settings page, the storage setup screen, the import button, the broadcast toggle) lives here. It does not talk to the car or the database directly. It just makes HTTP and WebSocket calls to the local server.

When you run the desktop app, the frontend gets built into static HTML/CSS/JS files and served by the server inside the Electron window.

## desktop/

This is the Electron shell plus the local server. It is the part that actually runs on your computer and makes everything work together.

Inside it:

- `desktop/main/` is the Node server. It boots an embedded Postgres database, runs migrations, starts the parser, and serves a Fastify API on port 4444. Routes live in `desktop/main/src/server/routes/`.
- `desktop/preload/` is a small bridge that lets the frontend ask Electron for things it cannot do itself, like opening a folder picker.
- `desktop/build/` has the build script and the vendored Postgres 17 binaries that ship inside the app. This means users do not need to install Postgres themselves.

When you build the .dmg, electron-builder packages all of this into one app and copies the frontend, the parser binary, the Postgres binaries, the migrations, and the DBC file into the app bundle.

## parser/

This is the Python program that reads the actual data. It does two main things:

1. Live mode. It opens a serial port, reads CAN frames coming off the car, decodes them using the DBC file, and writes them into Postgres in real time. The frontend gets the same frames over a WebSocket so you see them as they happen.
2. Batch mode. It reads a `.nfr` file (a binary log from the SD card on the car), decodes every frame, and inserts everything into Postgres as one session you can scroll through later.

The parser gets shipped as a single binary made with PyInstaller. The desktop app spawns it as a subprocess and tells it which mode to run in.

## docs/

Notes, design files, and references for the project. Nothing here runs.

## NFR26DBC.csv

The DBC file. It is the lookup table that tells the parser how to turn raw CAN bytes into named signals like `BMS_SOC` or `Battery_Voltage`. If the firmware on the car changes its message layout, this file has to change too.

## Using the app — first-time walkthrough

This section is for someone who just installed the .dmg and wants to know what every screen does. If you've never opened the app before, start here.

### Live mode

This is what you see when the app first opens. The dock is your dashboard — graphs, numbers, gauges, gg-plot, cell-voltage strip, etc. — fed by the basestation receiver over USB.

**One-time setup.** Plug the USB receiver in, then go to **Settings → Live serial port**. Click **Rescan**, pick the device that shows up (something like `cu.usbmodem326D...` on macOS or `COM5` on Windows), click **Save**. The parser restarts and the dock starts receiving frames whenever the basestation has signal. The dropdown only shows USB-serial devices — the storage USB is filtered out.

**Top-bar pill (RSSI + SNR).** Bottom-right of the top bar there's a pill showing `RSSI ... dBm · SNR ... dB`. Colour-codes by RSSI (green ≥ -70, amber ≥ -90, red below, grey when the receiver is unplugged). The pill is also a button — click it to open the **Live Tools** modal:

- **Reset live data** wipes the daily `live_today` buffer and clears the dock's in-memory store. Useful when you want to start from a clean slate.
- **Test with synthetic data** lets you pick signals from the DBC catalog (only signals with a usable min/max range are listed) and click **▶ START TEST**. The desktop emits a 10 Hz sine wave per selected signal — each one getting its own frequency and phase so they don't all peak together — directly into the same WebSocket fan-out real frames use. Graphs immediately oscillate between each signal's catalog min and max. While running, the pill border + dot turn green and the badge reads `SIM`. Click the pill again, hit **■ STOP TEST**.

**Pause the view.** Bottom-left of the dock there's a small green `LIVE` indicator next to the elapsed-time counter. Click it → label turns to `PAUSED`, the dot dims, the time axis freezes so you can read values without dragging the slider. Data ingestion keeps running — the store still receives frames, they just stay invisible. Click again to resume; the right edge snaps back to "now".

**Zoom on a graph.** Click-drag horizontally on any graph to zoom into a range. The corner reset-zoom button appears. In live mode, zoom freezes the visible window (same effect as pausing) without stopping ingestion — reset to resume following live data.

**Time window per graph.** Each graph has a gear icon → opens an inspector panel. In there, the **TIME WINDOW** section sets how much of the past the graph shows: `1 MIN` (default in live mode), `5 MIN`, or `ALL`. In live mode this caps how far back the line goes so a long buffer doesn't squeeze the most recent data into a sliver. In replay mode the default is `ALL` (full session) — flip to `1 MIN` / `5 MIN` if you want a tight window that follows the scrubber.

**G-G plot.** Defaults to the raw IMU acceleration pair (`X_Axis_Acceleration` / `Y_Axis_Acceleration`, with gravity). Open the widget's gear icon → **SOURCE** section → flip to **NO-G** to use the gravity-compensated pair (`No_G_X_Axis_Acceleration` / `No_G_Y_Axis_Acceleration`). X plots vertically (throttle/brake = up/down), Y plots horizontally (cornering = left/right).

**Cell voltages.** Add the Cell-V widget and it auto-discovers all `cell_v_<n>` (or `Cell_V_<n>`) signals from the DBC and plots them as a single multi-line graph.

**Live data retention.** The `live_today` table is cleared every day at midnight America/Chicago. The desktop runs a cleanup query every 15 min that deletes anything from before today; you don't have to do anything.

### Replay mode

For watching a session that's already been recorded, either pulled from the cloud or imported from a `.nfr` file off the SD card.

**Open a session.** Click the session picker dropdown in the top bar. You get a calendar showing which days have sessions; click a day → list of sessions for that date with duration + driver/track/car. Most recent live session also appears at the very top if you have one. Click a session to load it.

**Scrubbing.** Drag the slider at the bottom to move the cursor through the session. Graphs show data around the cursor's position.

**Zoom.** Click-drag horizontally on a graph to zoom into a range. The visible-window narrowing applies across all graphs since they share a window. Double-click or hit reset-zoom to restore.

**Time window per graph.** Same `1 MIN` / `5 MIN` / `ALL` toggle as live mode (gear icon → TIME WINDOW). Default in replay is `ALL`. Switch to `1 MIN` if you want a narrow window that follows the scrubber as you drag through a long session.

### Importing data

The dock has an **↑ IMPORT NFR** button. Click it → pick **SINGLE FILE** or **FOLDER**. Folder mode imports every `.nfr` file inside in one shot with a progress overlay. If a file's content hash matches one already in your DB, the import is skipped (so re-importing a folder is safe).

**Re-decode with current DBC.** The import modal has a "Re-decode with current DBC (overwrites existing rows)" checkbox. Tick it if you've fixed the DBC since the original import and want to reprocess existing sessions. Without the box, dedup skips matching files.

**Cancel.** The progress overlay has a red **■ CANCEL** button. Click it → the current parse is killed mid-flight (DB transaction rolls back, no rows land for that file), and queued files are skipped.

**Skipped vs failed vs cancelled.** The overlay shows three counters and a yellow list of skipped files so you can tell at a glance what got dedup'd vs what actually parsed.

### DBC files

The dock has a **DBC ▾** menu in the top bar.

- **Import new DBC…** uploads a CSV that becomes the active DBC (parser restarts). Cross-platform: handles Excel's UTF-8 BOM, CRLF line endings, etc.
- **VIEW CURRENT DBC** opens a filterable table showing every signal in the loaded DBC with its frame ID, message, sender, start_bit, length, factor, offset, min/max, unit, cycle, and type.

### Settings page

Click the gear icon top-right to open Settings. Worth knowing:

- **Live serial port** — covered above. Save button greys out when the selected port matches what's already saved.
- **Cloud sync** — collapsible section (▸ to expand). Lists every local session grouped by day; expand a day to see individual sessions with date, hash, sync status. Days with an active upload error auto-expand. Each row shows `date · short-id · sync-state · status/Retry`. Bulk-upload, retry, delete-local, etc. are here. Live sessions are filtered out of this list (they don't have a Spaces upload path).
- **Cloud config** — Supabase + Spaces credentials. The .app ships with read-only defaults baked in so reading from the cloud "just works". The override sections (`▸ OVERRIDE SUPABASE (ADVANCED)` and `▸ WRITE CREDENTIALS (FOR UPLOADING)`) collapse by default; expand to paste your own. **SAVE** is disabled until you've actually changed something.
- **Live cloud sync** (under Cloud config) — toggle to push live frames to Supabase for cross-machine viewing. Disabled until you've supplied your own Supabase write creds (the bundled defaults are read-only).
- **Broadcast** — makes the dock reachable on the local network at `http://<your-ip>:4444`. Useful for putting the dashboard on a phone or tablet during testing.
- **Database tools** — stats, clear-by-date, CSV / SQL export, SQL import. Same data flow as the cloud sync but local-only.
- **Activity heatmap** — calendar showing which days you have data for.

### Sessions list

Top bar has a **SESSIONS** button → page listing every session in the local DB, newest first, with id / date / source / row count. Click one to open it in replay.

## Syncing data with the cloud (push and pull)

Cloud sync works like `git`. There are two directions, and they each have a clear winner:

- **Push (upload to cloud).** You select sessions in **Settings → Storage → Local** and click **Upload selected**. Your local copy gets sent to the cloud and becomes the canonical version there. Whatever was on the cloud for that session before is replaced. *Local wins on push.*
- **Pull (sync from cloud).** You go to **Settings → Storage → Cloud**, pick the sessions or days you want, and click **Pull selected**. The cloud version is downloaded and overwrites your local copy of those sessions. If you had been editing or re-parsing locally, those local changes are gone. *Cloud wins on pull.*

In other words: pushing is **"make the cloud match my local"** and pulling is **"make my local match the cloud."** Neither direction tries to merge — there is one canonical side per operation and the other side gets overwritten.

A few practical consequences:

- If you re-parse a day on your machine with a corrected DBC, the new parse is now the local version. To share it with everyone else, **push** it. To go back to what was on the cloud, **pull** it.
- Two teammates uploading the **same** drive day from different machines: the second person's upload is rejected with a "this session was already synced" message so they don't silently overwrite the first person's work. They can then **pull** to get the version that's there, or click "Re-upload anyway" if they're sure their copy is the right one.
- Deleting a session locally (**DELETE LOCAL** button) does **not** touch the cloud copy. You can always pull it back.
- The cloud holds the long-term archive. Local storage is just a fast working copy on your machine.
- **First time only — bulk migration.** A new install will show an
  **Upload all** button on the Local tab listing every unsynced session.
  Click it once to push all your historical drives to the cloud.
  Subsequent runs of the button only upload anything new since.
- **First-time install:** the .app ships with read-only cloud defaults
  baked in (Supabase project URL + anon key + Spaces public URL). Just
  open the app, go to Settings → Storage → Cloud, and pull whatever days
  you need. No keys to paste. To upload (push), you do still need to paste
  Spaces access + secret keys under Settings → Cloud config → "Write
  credentials."

Where the bytes actually live:

| What | Where |
| --- | --- |
| Drive listing (date, driver, car, notes) | Supabase Postgres — small metadata only |
| Per-signal sample rows (the bulk) | DigitalOcean Spaces — one Parquet file per CAN message source, per session |
| Live frames (while you're recording) | Local embedded Postgres, plus optionally streamed to Supabase `rt_readings` for the "cool factor" cloud live view (cleared nightly) |

## How it all fits together

You open the app. Electron starts the local server. The server boots embedded Postgres and runs migrations. The server spawns the parser, which connects to the car (or replays a file). The frontend opens in the Electron window and pulls live frames over a WebSocket and historical sessions over the HTTP API. You can also turn on broadcast mode in settings, which makes the dashboard reachable from any browser on the same WiFi.

## Running it for development

```
cd app && npm install && npm run dev      # frontend dev server on :5173
cd desktop && npm install                 # install electron deps
cd parser && python -m venv .venv && source .venv/bin/activate && pip install -e .
```

Then in the desktop folder run the orchestrator pointed at a Postgres you already have, or build the dmg with `npm run package` to get the standalone app.

## Building the .dmg

```
cd app && npm run build
cd parser && ./build.sh
cd desktop && npm run package
```

The output ends up in `desktop/release/`.

## Changelog

### v0.7.8

- **Bundled DBC updated.** `NFR26DBC.csv` refreshed with the latest
  signal definitions (+44 / −39 rows vs v0.7.7). Affects the default
  shipped with the .app and the parser's fallback when the user
  hasn't uploaded one; existing users with a custom uploaded DBC are
  unaffected (their `active-dbc.csv` keeps taking precedence).

### v0.7.7

- **Live mode renderer no longer grows unbounded in RAM.** The frame
  store now caps each signal at 50 000 in-memory rows (~28 min at
  30 Hz). When a buffer crosses the cap it gets trimmed back to 37 500
  in a single splice, so the per-push cost stays amortized O(1). Rows
  trimmed from memory still exist in `live_today` on disk;
  `ensureWindow` pages them back in if the user scrolls past the
  in-memory window. No on-screen change at typical use.
- **Live mode push path is no longer O(n log n).** The store used to
  re-sort every signal's entire buffer on every WS batch — at hour 1
  this was sorting millions of already-sorted rows. Now: append-only,
  with a per-row ordering check that triggers a sort just for buffers
  where an out-of-order row actually arrived (the
  `ensureWindow` × WS-edge race). Hot path is O(rows-in-batch).

### v0.7.6

- **Replay-open: ANALYZE the rollup so the planner uses its index.**
  v0.7.4's backfill populated `sd_rollup_1s` but never ran `ANALYZE`,
  so Postgres' stats for that table still reflected the empty
  post-CREATE state. With no stats it defaulted to a seq scan over
  the entire rollup on every call — which is exactly why the v0.7.5
  explicit-branch rewrite didn't move the needle. Migration `0018`
  runs `ANALYZE` once on existing installs; `0019` folds it into
  `populate_sd_rollup` so new imports stay analyzed.
- **`/api/sessions/:id/signals/window/explain` diagnostic route.**
  Returns the `EXPLAIN (ANALYZE, BUFFERS)` plan for the same call
  shape as the data route. Useful for confirming the index is being
  used, or for catching the next time a query falls off the fast path.

### v0.7.5

- **Replay-open: explicit-branch `get_signals_window`.** The v0.7.4
  UNION-ALL form relied on the planner constant-folding
  `p_bucket_secs >= 1.0` to prune the raw-`sd_readings` branch, but
  for parameterized SQL functions Postgres often plans both branches
  anyway — the raw branch then does its index seek even though it
  returns no rows, costing ~1 s on USB-backed disks. Migration `0017`
  rewrites the function in PL/pgSQL with an explicit `IF`: only the
  chosen branch is planned per call. Observed query time on the
  example session: ~1100 ms → expected sub-100 ms.

### v0.7.4

- **Replay open is ~100x faster on long sessions.** Migration `0016`
  adds `sd_rollup_1s`, a 1-second pre-aggregated rollup of `sd_readings`
  (`min`, `max`, `sum`, `n` per `(session_id, signal_id, second)`).
  `get_signals_window` now reads from the rollup whenever the graph
  bucket is `>= 1 s` (essentially every replay view), and falls back to
  raw `sd_readings` only for sub-second zoom-ins. The numbers are
  identical — `min` of mins, `max` of maxes, and `sum / sample_n` for
  the average are exact relative to the raw samples. The parser
  populates the rollup at the end of each batch import (~1% added cost);
  sessions imported before this version are lazily backfilled on first
  open (one slow open, fast forever after). The `[signals-window]
  lazy-backfill` log line marks when that happens.

### v0.7.3

- **Replay-open timing logs.** Three boundaries instrumented so a slow open
  can be attributed: `query` (embedded Postgres), `map` (Node row
  materialization), `route total` (Fastify request) on the server console,
  and `fetch` + `ingest` on the browser DevTools console. Output prefix is
  `[signals-window]` (server) and `[replay-frames]` (client). Used to
  diagnose whether USB-disk random I/O, JSON serialization, or
  client-side sort is the dominant cost when opening long replays.

### v0.7.2

Bug fixes shipped on top of the v0.7.0 daily-live-mode redesign:

- **Live: DBC upload now actually re-decodes the stream.** Uploading a new
  DBC restarted the parser subprocess but replaced the `ParserManager`
  instance, so the WebSocket fan-out (and `/api/live/status`, simulate
  route) kept listening to the dead old instance. The dock froze on
  stale values from before the upload — which read as "still parsing
  with the old DBC". `ParserManager` now exposes a `restart()` that
  respawns the child in place, preserving listener identity. (#20)
- **Live: RSSI/SNR badge no longer stays grayed when the link is up.**
  Two stacked bugs caused this. (1) `GET /api/live/status` never tracked
  link metrics, so a page that mounted mid-stream got `null` until the
  *next* `signal_quality` packet happened to arrive — packets that fired
  before the WebSocket opened were lost. The route now persists the
  latest RSSI/SNR and clears them on basestation disconnect. (2)
  `useLiveStatus` replaced the whole state when the initial GET
  resolved, clobbering any RSSI/SNR the WebSocket had already set in
  the gap between mount and fetch. It now merges. (#17)
- **Parser: 21-bit IMU "float"/"double" signals decode signed.**
  Already-resolved bugs (#15 GG plot only Q1, #16 IMU values
  out-of-range with no negatives) traced to the same root cause: 21-bit
  IMU fields marked `float` or `double` in the DBC were being decoded
  as unsigned, wrapping the negative half of the range to large
  positives. `decode.py` gates the IEEE-754 unpack path on
  `length in (32, 64)` so sub-word "float"/"double" entries fall
  through to the signed-int sign-extension branch; `compile.py` marks
  both `float` and `double` data types as `is_float=True` with
  `signed=True`. Re-parse pre-fix sessions to get correct values.
