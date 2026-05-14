# Web Redesign with Shared Widgets — Design

**Status:** Approved for planning
**Date:** 2026-05-13
**Goal:** Redesign the website (`frontend/interface/`) to match the desktop app's look and dock UX, sharing widget code between the two via a new monorepo package, while ensuring Supabase fetches are minimal and pre-joined server-side.

---

## Context

Today the codebase has two React apps:

- **`app/`** — desktop renderer (Vite + React 19). Single dock-grid screen with custom CSS-grid, inline-styled widgets, mono/oscilloscope chrome. Talks to a local Fastify server backed by embedded Postgres; live data via WebSocket.
- **`frontend/interface/`** — website (Vite + React 19, Vercel). Five pages (Home, Dash, Graphs, Replay, AppDownload) using `react-grid-layout`, recharts, framer-motion. Reads from Supabase via `src/lib/supabaseClient.ts` and `src/lib/paginatedFetch.js`.

The website's UX and visual style diverge from the desktop. The widget renderers and dock UX are the desktop's strongest differentiator, so we want them on the website too.

## Decisions

| Topic | Choice |
|---|---|
| Scope | Full re-platform with a shared widgets package |
| Live mode on web | Replay-only now; data layer designed so live drops in later |
| Repo shape | npm workspaces with `packages/widgets/` |
| Page structure | Keep `Home` + `AppDownload` (lightly reskinned); replace `Dash`/`Graphs`/`Replay` with a single `/app` dock screen |
| Migration | Side-by-side then cut over (each step independently shippable) |

## Architecture

```
daq-interface-26/
├── package.json                  ← root workspaces config (new)
├── packages/
│   └── widgets/                  ← shared UI package (new)
│       ├── package.json          (name: "@nfr/widgets")
│       └── src/
│           ├── widgets/          GraphWidget, NumericWidget, GaugeWidget,
│           │                     BarWidget, HeatmapWidget, GgPlotWidget,
│           │                     WidgetShell
│           ├── dock/             DockDirection, SignalSidebar, Inspector,
│           │                     grid math, drag-drop, compactVertical
│           ├── chrome/           TopBar, SignalChip, GroupPill, Timeline
│           ├── theme/            colors, fonts
│           └── data/             FramesStore interface, SignalCatalog
│                                 interface, FramesContext, SignalsContext
├── app/                          ← desktop renderer (existing)
│   └── src/
│       ├── adapters/             useLiveFrames (WS), useLocalCatalog
│       └── App.tsx               imports @nfr/widgets
├── frontend/
│   └── interface/                ← website (existing, redesigned)
│       └── src/
│           ├── adapters/         useSupabaseFrames, useSupabaseCatalog,
│           │                     useSessionList
│           ├── pages/            Home, AppDownload (kept, reskinned)
│           └── routes/app/       new dock screen using @nfr/widgets
└── desktop/                      ← Electron + server (untouched)
```

Root `package.json` declares `"workspaces": ["packages/*", "app", "frontend/interface", "desktop"]`. Both `app/` and `frontend/interface/` add `"@nfr/widgets": "*"` to deps. Vite resolves through workspace symlinks.

## Shared package contract

`@nfr/widgets` exports React components that read data from two contexts. Per-app adapters fill those contexts; widgets never know where data came from.

### Data interfaces

```ts
export interface FrameRow {
  ts: string;          // ISO timestamp
  signal_id: number;
  value: number;       // = avg when bucketed, raw value otherwise
  vMin?: number;       // bucket min, present iff downsampled
  vMax?: number;       // bucket max, present iff downsampled
}

export interface FramesStore {
  series(signalId: number): FrameRow[];
  latest(signalId: number): FrameRow | null;
  firstTs(): string | null;
  latestTs(): string | null;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

export interface SignalDefinition {
  id: number;
  source: string;
  signal_name: string;
  unit: string;
  min?: number;
  max?: number;
  description?: string;
}

export interface SignalCatalog {
  all(): SignalDefinition[];
  resolve(id: number | string): SignalDefinition | null;
  groups(): SignalGroup[];
}
```

### Public components

- `DockDirection` — top-level dock screen (sidebar + grid + inspector)
- `WidgetShell`, `GraphWidget`, `NumericWidget`, `GaugeWidget`, `BarWidget`, `HeatmapWidget`, `GgPlotWidget` — individual renderers
- `TopBar`, `Timeline`, `SignalChip`, `GroupPill`
- `FramesProvider`, `SignalsProvider` — context wrappers each adapter populates
- `useFrames()`, `useCatalog()` — hooks the widgets call internally

### What each app provides

**Desktop** (`app/src/adapters/`):
- `useLiveFrames` — WebSocket subscription, writes to a ring-buffered `FramesStore`
- `useLocalCatalog` — reads `/api/signal-definitions` from the local Fastify server

**Website** (`frontend/interface/src/adapters/`):
- `useSupabaseFrames(sessionId)` — populated by paginated Supabase RPC calls
- `useSupabaseCatalog` — reads `signal_definitions` once on mount
- `useSessionList()` — reads from `list_sessions` RPC for the picker

The widgets' existing `frames?.firstTs()` / `latestTs()` calls (the x-axis fix from the previous round) work over this interface unchanged.

## Supabase data layer

### Three rules applied to every fetch

1. **Only the signals on screen** — query passes the exact list of signal IDs the dock currently has widgets for.
2. **Only the time range visible** — initial load fetches the full session at low resolution; zoom fetches the narrow range at higher resolution.
3. **Only the columns rendered** — explicit column lists, never `select *` on `sd_readings`.

### New RPCs to add

```sql
-- Multi-signal bucketed window with envelope (min/max) and join.
-- Workhorse for the dock — replaces N parallel calls with ONE round-trip.
CREATE OR REPLACE FUNCTION get_signals_window(
  p_session_id   UUID,
  p_signal_ids   SMALLINT[],
  p_start        TIMESTAMPTZ,
  p_end          TIMESTAMPTZ,
  p_bucket_secs  INT
)
RETURNS TABLE (
  ts          TIMESTAMPTZ,
  signal_id   SMALLINT,
  signal_name TEXT,
  unit        TEXT,
  value_min   DOUBLE PRECISION,
  value_max   DOUBLE PRECISION,
  value_avg   DOUBLE PRECISION,
  sample_n    INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    time_bucket(make_interval(secs => p_bucket_secs), r.ts) AS ts,
    r.signal_id,
    d.signal_name,
    d.unit,
    min(r.value)            AS value_min,
    max(r.value)            AS value_max,
    avg(r.value)            AS value_avg,
    count(*)::INT           AS sample_n
  FROM sd_readings r
  JOIN signal_definitions d ON d.id = r.signal_id
  WHERE r.session_id = p_session_id
    AND r.signal_id = ANY(p_signal_ids)
    AND r.ts >= p_start AND r.ts < p_end
  GROUP BY 1, 2, 3, 4
  ORDER BY 1;
$$;

-- Session list with row counts so the picker shows duration/sample count
-- without a second query.
CREATE OR REPLACE FUNCTION list_sessions(p_limit INT DEFAULT 50)
RETURNS TABLE (
  id            UUID,
  date          DATE,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_secs INT,
  driver        TEXT,
  car           TEXT,
  signal_count  INT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    s.id, s.date, s.started_at, s.ended_at,
    EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::INT AS duration_secs,
    s.driver, s.car,
    (SELECT count(DISTINCT signal_id)::INT FROM sd_readings
       WHERE session_id = s.id) AS signal_count
  FROM sessions s
  ORDER BY s.started_at DESC
  LIMIT p_limit;
$$;
```

`time_bucket` requires the `timescaledb` extension; if not installed we substitute `date_trunc` with bucket-aligned arithmetic. The existing `get_session_overview` RPC already uses bucketing, so the dependency is presumably resolved — to be confirmed during step 4.

### Dock load flow

1. **Signal catalog** — single `select * from signal_definitions` on mount, cached in `SignalsContext`.
2. **Session list** — `rpc('list_sessions')` once on mount for the picker.
3. **Session metadata** — `select id, started_at, ended_at, driver, car, track from sessions where id = ?`.
4. **Initial overview** — `rpc('get_signals_window', { p_signal_ids: [all signals on the dock], p_start: started_at, p_end: ended_at, p_bucket_secs: bucketFor(durationSecs, 800) })`. Populates the `FramesStore` so the dock renders immediately.
5. **High-res on demand** — when a widget is added or zoomed into a narrower range, fire another `get_signals_window` for that range and merge into the store.

### Bucket sizing

Target ~800 buckets per query. `bucketFor(durationSecs, 800) = max(1, round(durationSecs / 800))`. A 1-hour session → 4-second buckets; a 5-minute zoom → 0.4-second buckets. Wire payload stays roughly constant regardless of session length or zoom level.

### Min/max envelope rationale

Average alone hides transients. A brake-pressure signal that spikes for 200 ms inside a 4-second bucket disappears in the average. Returning `value_min`, `value_max`, and `value_avg` per bucket lets `GraphWidget` draw a thin envelope band (min..max) under the avg trace, preserving the visible behavior even at low resolution. Same row count, ~3× bytes per row, payload well under 100 KB for typical dock states.

`GraphWidget` checks for `vMin`/`vMax` on each `FrameRow`. If present, draw envelope; if absent (raw range, no bucketing), render as a simple line.

### Round-trip budget per page load

1. `signal_definitions` — once, cached
2. `list_sessions` — once
3. `get_signals_window` — once per dock-state change

No N+1, no client-side joins, no over-fetching.

### Verification plan

- Wire `useSupabaseFrames` against a real session UUID and render *one* `GraphWidget` before building the rest of the dock.
- Add a session-picker dropdown (uses `list_sessions`) — smoke test that catalog + session list both return.
- Add a status badge in the `TopBar` surfacing loading/connected/error state. Today the website silently logs Supabase errors; we'll surface them.

### Gotchas

- `paginatedFetch.js` already handles the 1000-row PostgREST cap. Keep it for `signal_definitions` and `list_sessions`. Readings always go through RPCs, which handle pagination internally.
- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars are already configured. Same anon-key/RLS posture as today.

## Pages and routing

```
/                  Home (existing — light reskin: mono font, dark theme,
                   purple accent; content unchanged)
/download          AppDownload (same reskin treatment)
/app               new dock screen — TopBar + signal sidebar + grid
/app?session=<id>  same screen, deep-linkable to a session
/dash      → 301 → /app    (after step 8 cutover)
/graphs    → 301 → /app    (after cutover)
/replay    → 301 → /app    (after cutover)
```

Session selection lives in the URL so links into a specific session work. Widget layout persists in `localStorage` under the existing `daqWidgetLayout` key, so users don't lose saved layouts in the cutover.

`SessionContext`'s remaining concern (mode toggle, persistence) becomes a thin wrapper around URL state. Most of its current responsibilities move into `FramesProvider` and `SignalsProvider`.

## Migration plan

Each step is a self-contained PR that leaves the deployed site working.

1. **Workspace setup.** Add root `package.json` with `"workspaces"`. Verify `app/`, `frontend/interface/`, `desktop/` still build and test. No user-visible changes.
2. **Extract `@nfr/widgets`.** Move `app/src/components/{widgets,dir-dock,SignalsProvider,FramesContext,colors,shell}.tsx` into `packages/widgets/src/`. Update `app/` imports to `@nfr/widgets`. Desktop behaves identically; existing tests pass.
3. **Define data interfaces.** Add `FramesStore` / `SignalCatalog` interfaces in `packages/widgets/src/data/`. Refactor desktop's `useLiveFrames` and signal provider to satisfy them (mostly type-only).
4. **Add Supabase RPCs.** Apply migration adding `get_signals_window` and `list_sessions` (via `mcp__supabase__apply_migration`). Verify with `mcp__supabase__execute_sql`.
5. **Build website adapters.** `useSupabaseCatalog`, `useSupabaseFrames(sessionId)`, `useSessionList()`. One-off test page at `/app-dev` renders a single `GraphWidget` against a real session — proves end-to-end before the full dock.
6. **Build `/app` route.** Wire up `DockDirection`, the adapters from step 5, session-picker dropdown. Marketing pages and old Dash/Graphs/Replay still work.
7. **Reskin marketing pages.** Apply the desktop's color/font/chrome to Home and AppDownload. Same content, new look.
8. **Cutover.** Add 301 redirects from `/dash`, `/graphs`, `/replay` to `/app`. Delete the old page components and unused dependencies (`react-grid-layout`, `recharts`, etc., only if not imported elsewhere). Update header nav.

## Testing

- **Shared package** — vitest in `packages/widgets/`. Snapshot tests for each renderer with mock `FramesStore`/`SignalCatalog`. Pure-function tests for dock layout (`compactVertical`), drop-action router.
- **Desktop** — existing vitest suite stays; step 1's PR must include a green `npm test` from `desktop/` to prove workspace resolution didn't break the build.
- **Website adapters** — vitest with the Supabase JS client mocked. Verify: `bucketFor` picks sensible numbers, `get_signals_window` is called with expected params for a given dock state, `FramesStore` partitions rows by `signal_id` correctly, `vMin`/`vMax` round-trip into `FrameRow`.
- **End-to-end** — manual smoke against a Supabase dev branch (`mcp__supabase__create_branch`) using a known session UUID. Check x-axis labels match session duration. Confirm at least one transient-heavy signal shows an envelope.
- **Visual regression** — out of scope for v1.

## Out of scope (explicitly)

- Live mode on the website (`rt_readings` + Supabase Realtime).
- Authentication / RLS hardening — the current anon-read posture is preserved.
- Mobile-specific layouts.
- Visual regression infrastructure.
- Refactoring the desktop's drag-drop math (beyond what extraction requires).
- Changes to the parser / desktop server.
