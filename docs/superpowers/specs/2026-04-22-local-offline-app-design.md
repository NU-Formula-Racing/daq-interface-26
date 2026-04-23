# Local Offline Desktop App — Design Spec

**Date:** 2026-04-22
**Status:** Approved for implementation planning

## Goal

Ship a desktop application that runs the NFR 26 DAQ interface fully offline — no cellular, no WiFi dependency. The laptop connected to the basestation becomes a self-contained unit: parser, database, and UI all on one machine. Optionally, that laptop can expose its UI and live telemetry to other devices on a local WiFi network ("broadcast mode") so a pit wall can watch along.

Data captured locally can later be synced back to the existing Supabase deployment when internet is available.

## Non-goals (v1)

- Programmatic WiFi hotspot creation. Users enable OS Internet Sharing / phone tether themselves.
- HTTPS / proper auth. Security model is "trusted LAN + per-session token on the query string."
- Multi-host sync or conflict resolution.
- Background / timer-driven cloud sync. Manual "Sync now" button only.
- User accounts, per-peer permissions.
- Auto-update for the Electron app.

## High-level architecture

Electron shell + Python parser subprocess + user-installed local Postgres.

```
┌──────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│                                                          │
│  ┌────────────────┐   ┌───────────────────────────────┐  │
│  │ Python Parser  │   │   HTTP + WebSocket Server     │  │
│  │  (subprocess)  │──▶│   (Fastify, on 0.0.0.0/127)   │  │
│  │  PyInstaller   │   │                               │  │
│  └───────┬────────┘   │  • REST: sessions, readings   │  │
│          │            │  • WS:   live frames fan-out  │  │
│          ▼            │  • Static: React build        │  │
│  ┌────────────────┐   └──────────────┬────────────────┘  │
│  │  Postgres      │◀─────────────────┘                   │
│  │ (user-installed│                                      │
│  │  on localhost) │                                      │
│  └────────────────┘                                      │
│                                                          │
│  ┌────────────────┐   ┌───────────────────────────────┐  │
│  │ Folder Watcher │──▶│   SD Import Worker            │  │
│  │ (chokidar)     │   │   (spawns parser --batch)     │  │
│  └────────────────┘   └───────────────────────────────┘  │
└─────────────────────┬────────────────────────────────────┘
                      │
         ┌────────────┴─────────────┐
         ▼                          ▼
  ┌─────────────┐           ┌──────────────┐
  │ Electron    │           │ Peer devices │
  │ Renderer    │           │ (browsers on │
  │ (React UI)  │           │  same WiFi)  │
  └─────────────┘           └──────────────┘
```

### Components

- **Electron main (Node/TypeScript).** Orchestrator. Owns process lifecycle for the parser and SD-import workers. Hosts a Fastify server that serves both REST and WebSocket endpoints plus the static React build.
- **Python parser (PyInstaller bundle).** Reused `compile.py` + `decode.py` plus an extended `upload.py`-style runner. Two invocation modes: `live` (long-running, reads serial) and `--batch <file>` (decode one SD log file and exit). Communicates with main over stdout JSON lines and stdin commands.
- **Fastify HTTP + WS server.** Inside the Electron main process. Binds `127.0.0.1` by default; rebinds `0.0.0.0` + token-auth when broadcast mode is on. Serves the React UI and the API.
- **Postgres.** User-installed on `localhost:5432`. App creates its own database (`nfr_local`) and runs migrations on first launch. App never tries to install or bundle Postgres.
- **Folder watcher (chokidar).** Watches a user-configured directory for new `*.nfr` files; each new file enqueues an SD import.
- **Renderer (React).** The existing Vite + React 19 project, lightly refactored to swap its Supabase data layer for a local `dataSource` implementation. Visual target for the live/replay dashboard is the FSAE Dashboard design (see "Frontend" below).

### Data flows

- **Live:** serial → parser → stdout JSON → Electron main → (a) fan out on `/ws/live`; (b) parser writes batches to Postgres directly. The UI never reads live data from Postgres.
- **Replay:** renderer → REST → Postgres RPC → rows back.
- **SD import:** file appears → watcher → `parser --batch` subprocess → bulk insert via `COPY FROM STDIN`.
- **Cloud sync (scaffolded, manual trigger):** background uploader scans `sessions WHERE synced_at IS NULL`, pushes to Supabase, updates `synced_at`.

## Process model & IPC

### Runtime processes

1. **Electron main** — Node. Server + orchestration.
2. **Renderer** — Chromium loading the static React bundle served by the local Fastify server.
3. **Parser live** — long-running Python child, started at app launch. Loops trying to open the configured serial port; auto-starts and auto-ends sessions based on serial connect/disconnect.
4. **Parser batch (transient)** — same binary, `--batch <file>` form, spawned per SD import. Runs in parallel with live.

### Parser → main (stdout, newline-delimited JSON)

```
{"type":"serial_status","state":"connected|disconnected","port":"..."}
{"type":"session_started","session_id":"<uuid>","source":"live|sd_import"}
{"type":"frames","rows":[{"signal_id":42,"value":12.3,"ts":"..."}, ...]}
{"type":"session_ended","session_id":"<uuid>","row_count":12345}
{"type":"import_progress","file":"x.nfr","pct":37}
{"type":"error","msg":"..."}
```

### Main → parser (stdin, JSON commands)

```
{"cmd":"set_port","port":"/dev/..."}
```

Recording is **not** user-controlled. There is no `start_recording` / `stop_recording`. The parser auto-creates a `sessions` row when the serial connection opens and auto-closes it on disconnect or idle timeout.

### HTTP API (all JSON)

- `GET  /api/sessions?from=&to=` — list sessions.
- `GET  /api/sessions/:id` — metadata + available signals.
- `PATCH /api/sessions/:id` — edit track/driver/car/notes.
- `DELETE /api/sessions/:id` — delete session + its rows.
- `GET  /api/sessions/:id/overview?bucket=...` — calls `get_session_overview`.
- `GET  /api/signals/:signal_id/window?session=...&start=...&end=...` — calls `get_signal_window`.
- `GET  /api/signal-definitions` — catalog.
- `GET  /api/live/status` — `{basestation: "connected"|"disconnected", session_id?: ..., duration_s?: ...}`.
- `GET  /api/config` / `POST /api/config` — serial port, broadcast toggle, watch folder, DBC CSV path, Supabase sync creds.
- `POST /api/sync/push` — manual cloud sync trigger; returns progress events on `/ws/events`.

### WebSocket channels

- `WS /ws/live` — every decoded live frame, fanned out to all subscribers. Clients may send `{"op":"subscribe","signal_ids":[...]}` to filter; default is unfiltered.
- `WS /ws/events` — app-level events: serial_status changes, session_started/ended, import_progress, sync progress.

### Binding & auth

- Default bind: `127.0.0.1:<port>`.
- Broadcast toggle rebinds to `0.0.0.0:<port>` and regenerates a 128-bit random token.
- All `/api/*` and `/ws/*` requests require the token (`?key=<token>` or `Authorization: Bearer <token>`) when broadcast is on.
- The local renderer gets the token via Electron contextBridge. Peers get it embedded in the QR-code URL.
- Turning broadcast off invalidates the token; active peer sessions drop to 401.
- No HTTPS.

### First-launch bootstrap

1. Probe `localhost:5432`. If unreachable, show setup screen with per-OS install instructions and a "Retry" button.
2. Ensure database `nfr_local` exists; create if missing.
3. Run pending migrations from `desktop/migrations/*.sql` in order, tracked in a `schema_migrations` table.
4. Seed `signal_definitions` from the bundled DBC CSV (idempotent upsert).
5. Start the live parser subprocess.

### Crash recovery

On app start, any `sessions` row with `ended_at IS NULL` is auto-closed: `ended_at` is set to `MAX(ts)` of its readings, and its `rt_readings` rows are flushed into `sd_readings` in a transaction. Keeps the live buffer clean and prevents ghost-open sessions.

## Database schema (local Postgres)

Database: `nfr_local`. Vanilla Postgres — no partitioning, no `pg_cron`, no Supabase extensions.

```sql
CREATE TABLE signal_definitions (
  id           SMALLSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  signal_name  TEXT NOT NULL,
  unit         TEXT,
  description  TEXT,
  UNIQUE (source, signal_name)
);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  track        TEXT,
  driver       TEXT,
  car          TEXT,
  notes        TEXT,
  source       TEXT NOT NULL CHECK (source IN ('live','sd_import')),
  source_file  TEXT,
  synced_at    TIMESTAMPTZ
);
CREATE INDEX ON sessions (date);
CREATE INDEX ON sessions (synced_at) WHERE synced_at IS NULL;

CREATE TABLE sd_readings (
  ts           TIMESTAMPTZ NOT NULL,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_id    SMALLINT NOT NULL REFERENCES signal_definitions(id),
  value        DOUBLE PRECISION NOT NULL
);
CREATE INDEX ON sd_readings (session_id, signal_id, ts);

CREATE TABLE rt_readings (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  signal_id    SMALLINT NOT NULL REFERENCES signal_definitions(id),
  value        DOUBLE PRECISION NOT NULL
);
CREATE INDEX ON rt_readings (signal_id, ts DESC);

CREATE TABLE app_config (
  id           INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE schema_migrations (
  version      TEXT PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Differences from the Supabase schema

- `sd_readings` is a plain table. No monthly partitioning (overkill for a single laptop).
- No `pg_cron`. When a live session ends, its `rt_readings` rows are moved into `sd_readings` (single `INSERT … SELECT` + `DELETE`, in a transaction). `rt_readings` stays small without losing data.
- Added `sessions.source` and `sessions.source_file` to distinguish live vs. imported sessions and remember origin.
- Added `sessions.synced_at` for the manual cloud-sync path.
- Added `app_config` (single-row JSONB) so settings survive relaunches and can be peer-edited.

### RPC functions

Ported verbatim from Supabase:

- `get_signal_downsampled(session_id, signal_id, bucket_interval)`
- `get_session_signals(session_id)`
- `get_signal_window(session_id, signal_id, start, end)`
- `get_session_overview(session_id, bucket_secs)`

### UI reading paths

- **Live view:** WS `/ws/live` only. Never queries the DB.
- **Replay:** REST `/api/sessions/:id/overview` then `/api/signals/:signal_id/window` for zoomed detail.
- **Signal browser:** REST `/api/signal-definitions` + `get_session_signals`.

## Live capture, SD import, broadcast

### Live capture (auto-recorded; no user action required)

1. App launch → main spawns parser live subprocess.
2. Parser loops, trying the configured port. State changes emit `serial_status` events.
3. On `connected`: parser creates a `sessions` row (`source='live'`), begins inserting batches into `rt_readings`, and forwards each decoded frame to main as a `frames` message. Main fans them out on `/ws/live`.
4. UI shows a passive header banner: `RECORDING · session <id> · <n> signals · <duration>`.
5. On idle timeout (10s, matches current `upload.py`) or `SerialException`: parser ends the session — sets `ended_at`, moves `rt_readings` → `sd_readings` in one transaction, emits `session_ended`.
6. UI header clears to `BASESTATION: DISCONNECTED`.

### SD import flow

1. User configures the watch folder in Settings (stored in `app_config`).
2. `chokidar` watches the folder for new `*.nfr` files, with `awaitWriteFinish` to avoid partial reads.
3. On new file → queue an import job (serial queue; one at a time).
4. Spawn `parser --batch <path> --session-name <file-stem>`.
5. Parser creates a `sessions` row (`source='sd_import'`, `source_file=<path>`), decodes the entire file, bulk-inserts via `COPY FROM STDIN`, sets `ended_at = MAX(ts)`, exits.
6. Progress streams on `/ws/events`; UI shows an "Imports" sidebar with per-file progress bars.
7. On failure, the session row is kept and marked `notes = 'import failed: <msg>'` (empty but visible — user can delete).
8. **Dedupe:** files whose absolute path already appears in `sessions.source_file` are skipped. Re-import requires deleting the session first.
9. "Import folder now" button triggers a one-shot re-scan.

### Broadcast mode

Settings → "Broadcast on LAN" toggle. When on:

- Server rebinds to `0.0.0.0:<port>`.
- A fresh 128-bit token is generated.
- Host UI shows a modal/banner with LAN IP + port, a QR code (`http://<ip>:<port>/?key=<token>`), and a Copy button.
- Peer browsers persist the token in `localStorage` for the session.
- Turning broadcast off rebinds to `127.0.0.1` and invalidates the token.

Peers can:

- View live data (WS `/ws/live` on the host).
- Browse and replay past sessions.
- Edit session metadata (track/driver/car/notes).

Peers cannot start, stop, or otherwise control recording — recording is purely a function of the basestation being plugged into the host machine, so there is no control surface to expose.

## Frontend

### Data-layer refactor

Introduce `src/lib/dataSource.ts` in `frontend/interface/` with a single interface:

```ts
interface DataSource {
  listSessions(filters): Promise<Session[]>;
  getSession(id): Promise<SessionDetail>;
  getSessionOverview(id, bucketSecs): Promise<OverviewRows>;
  getSignalWindow(sessionId, signalId, start, end): Promise<Rows>;
  listSignalDefinitions(): Promise<SignalDef[]>;
  subscribeLive(onFrame): Unsubscribe;
  subscribeEvents(onEvent): Unsubscribe;
  updateSession(id, patch): Promise<void>;
}
```

- `supabaseDataSource` wraps today's Supabase calls.
- `localDataSource` talks to `/api/*` and `/ws/*`.
- Build-time flag (`VITE_DATA_SOURCE=local|cloud`) selects the implementation at bundle time.

### FSAE Dashboard design integration

The design bundle from Claude Design (`FSAE Dashboard.html` + `lib/`) is the visual target for the live/replay dashboard inside the Electron app.

- Port `shell.jsx`, `dir-dock.jsx`, `widgets.jsx` from the prototype into the Vite + React 19 project as real components. Drop the React 18 UMD + Babel-standalone scaffolding; use the project's existing build pipeline.
- Strip the `TWEAKS` edit-mode postMessage code — it's a Claude Design authoring hook, not a user feature.
- Replace `signals.js` mock data with `dataSource` calls (WS for live, REST for replay).
- Preserve visual details pixel-faithfully:
  - Palette: `#1e1f22` (app bg), `#2b2d30` (panels), `#dfe1e5` (text), accent `#4E2A84` (user-tunable).
  - Typography: **Inter** for UI, **JetBrains Mono** for labels and numeric readouts.
  - Widget library: gauges, line/area/step graphs, numeric readouts.
  - Per-user settings (move out of the dev-only TWEAKS panel into real Settings UI): accent color, graph style (line/area/step), density (compact/comfortable).

## Python parser changes

- Add `--batch <file>` flag: decode a single log file and exit.
- Swap `supabase.create_client(...)` and `.insert(...)` for `psycopg` against local Postgres. Use `COPY FROM STDIN` for bulk inserts (batch mode) and `INSERT` for live batches.
- Emit the stdout line protocol defined in Process Model. No more `print(...)` for human consumption during live mode.
- Keep `compile.py`, `decode.py`, signal spec, and existing tests unchanged.
- Auto-session lifecycle: open session on serial connect, close on idle-timeout / `SerialException` (moving `rt_readings` → `sd_readings` inside a transaction).

## Cloud sync (scaffolded, manual-only in v1)

- `POST /api/sync/push` triggers a one-shot sync.
- Implementation: for each session with `ended_at IS NOT NULL AND synced_at IS NULL`, push the `sessions` row plus its `sd_readings` rows to Supabase via its REST API, then set `synced_at = now()`.
- Supabase URL + anon key stored in `app_config`.
- Progress streams on `/ws/events`.
- No automatic timer, no retry logic beyond "fail the request and leave `synced_at` NULL." Timer-driven background sync is deferred.

## Repository layout

```
daq-interface-26/
├── app/                    # existing (unused placeholder)
├── frontend/interface/     # existing Vite React, refactored with dataSource layer
├── parser/                 # existing Python parser, extended with --batch mode
├── desktop/                # NEW
│   ├── main/               # Electron main (Node/TS): Fastify server, IPC, watcher
│   ├── preload/            # contextBridge: exposes local API + auth token
│   ├── migrations/         # numbered SQL migration files
│   ├── build/              # electron-builder config, icons
│   └── package.json
└── package.json            # workspace root
```

## Packaging

- `electron-builder` produces `.dmg` (mac-arm64, mac-x64) and `.exe` (win-x64). Linux AppImage optional.
- Python parser shipped as a per-platform PyInstaller single binary in `desktop/resources/parser-<platform>/`.
- A default DBC CSV ships with the app; users can swap it via Settings (triggers a `signal_definitions` upsert).
- No auto-update in v1. New versions are installer downloads.

## Testing

- **Parser unit tests:** existing `parser/tests/` unchanged; cover decode math.
- **Parser integration:** add one test that runs `parser --batch` against a fixture file and verifies `sessions` + `sd_readings` rows in a throwaway Postgres.
- **Server integration:** a handful of tests against a throwaway Postgres hitting `/api/sessions/:id/overview`, `/api/signals/:id/window`, `/api/live/status` to verify RPC and IPC wiring.
- **UI:** light manual smoke — fake parser binary emitting canned frames on stdout, verify live dashboard renders; import a fixture `.nfr` and verify replay.
- **End-to-end:** one scripted flow — mock serial device → verify session row + `rt_readings` populated → unplug → verify session closed and rows moved to `sd_readings`.
- **Broadcast mode:** manual only — second device on the LAN visits the QR URL and loads the UI.

## Open questions / future work

- Cloud sync: conflict resolution, incremental updates to an already-synced session (currently assumed write-once).
- DBC CSV changes that rename or re-ID signals: migration path for historical data.
- Retention policy for `sd_readings` on long-running installs (assume unbounded in v1).
- True WiFi AP creation (currently delegated to OS).
