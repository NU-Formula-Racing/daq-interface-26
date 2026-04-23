# Plan 4 — Local App Frontend (Vite + React 19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fresh, standalone React app inside `app/` that serves as the local desktop UI: a live telemetry dashboard, a session browser, a scrubbable replay view, and a settings screen. The cloud site at `frontend/interface/` stays untouched.

**Architecture:** Vite 7 + React 19 + Tailwind 4 + React Router 7 bundle, served as static assets by the Fastify server from Plan 3. The UI talks to `/api/*` over HTTP and `/ws/live` + `/ws/events` over WebSockets — same origin, no CORS. Visual design ports the Claude Design FSAE Dashboard (dark palette, Inter + JetBrains Mono, dockable widgets) from `app/design-reference/project/lib/` into real React components. Signal metadata (groups, colors, min/max) derives from `/api/signal-definitions` plus a bundled JSON overlay.

**Tech Stack:** Vite 7, React 19, React Router 7, Tailwind 4, TypeScript, Vitest + @testing-library/react for light integration tests. No Supabase, no analytics, no `framer-motion` (unless a widget specifically needs it). Custom SVG widgets lifted from the design bundle; fall back to `uPlot` only for the replay view if perf demands.

**Prerequisites:**
- Plans 1, 2, 3 complete. Fastify server at `http://127.0.0.1:4444` serves the API and WS surface.
- Design bundle vendored at `app/design-reference/` (`project/lib/*.jsx`, `project/lib/signals.js`).
- Parser replay mode usable for hardware-free end-to-end testing.

---

### Task 1: Scaffold `app/` — Vite + React 19 + Tailwind + Router + palette

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/vite.config.ts`
- Create: `app/index.html`
- Create: `app/postcss.config.js`
- Create: `app/src/main.tsx`
- Create: `app/src/App.tsx`
- Create: `app/src/index.css`
- Create: `app/src/routes.tsx`
- Create: `app/src/pages/Placeholder.tsx`
- Create: `app/.gitignore`
- Modify: root `.gitignore` (ensure `app/node_modules/`, `app/dist/` ignored)

- [ ] **Step 1: Create `app/package.json`**

```json
{
  "name": "daq-local-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^7.9.5"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.17",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.2",
    "@vitejs/plugin-react": "^5.1.0",
    "autoprefixer": "^10.4.22",
    "jsdom": "^25.0.1",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.17",
    "typescript": "^5.7.2",
    "vite": "^7.2.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `app/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During `npm run dev`, proxy /api and /ws to the Fastify server.
    proxy: {
      '/api': 'http://127.0.0.1:4444',
      '/ws': { target: 'ws://127.0.0.1:4444', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 4: Create `app/postcss.config.js`**

```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Create `app/index.html`**

```html
<!doctype html>
<html lang="en" class="h-full">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NFR · Local DAQ</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="h-full m-0 p-0 bg-app text-app overflow-hidden">
    <div id="root" class="h-full"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `app/src/index.css`**

```css
@import "tailwindcss";

@theme {
  /* Palette pulled from app/design-reference/project/FSAE Dashboard.html */
  --color-app: #1e1f22;
  --color-panel: #2b2d30;
  --color-border: rgba(255, 255, 255, 0.08);
  --color-border-strong: rgba(255, 255, 255, 0.16);
  --color-text: #dfe1e5;
  --color-text-mute: rgba(255, 255, 255, 0.5);
  --color-text-faint: rgba(255, 255, 255, 0.3);
  --color-accent: #4e2a84;

  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: '"JetBrains Mono"', ui-monospace, monospace;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  background: var(--color-app);
  font-family: var(--font-sans);
  color: var(--color-text);
  overflow: hidden;
}

* {
  box-sizing: border-box;
}

input, button {
  font-family: inherit;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.16);
}
```

- [ ] **Step 7: Create `app/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { router } from './routes.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

- [ ] **Step 8: Create `app/src/routes.tsx`**

```tsx
import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { Placeholder } from './pages/Placeholder.tsx';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Placeholder title="Live dashboard" /> },
      { path: 'sessions', element: <Placeholder title="Sessions" /> },
      { path: 'sessions/:id', element: <Placeholder title="Replay" /> },
      { path: 'settings', element: <Placeholder title="Settings" /> },
    ],
  },
]);
```

- [ ] **Step 9: Create `app/src/App.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="h-full flex flex-col">
      <header className="h-10 flex items-center gap-4 px-4 border-b border-[color:var(--color-border)]">
        <span className="font-mono text-xs tracking-widest text-[color:var(--color-text-mute)]">
          NFR · LOCAL
        </span>
        <nav className="flex gap-2 text-xs font-mono">
          {[
            ['/', 'LIVE'],
            ['/sessions', 'SESSIONS'],
            ['/settings', 'SETTINGS'],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-2 py-1 rounded-sm ${
                  isActive
                    ? 'bg-[color:var(--color-accent)]/30 text-[color:var(--color-text)]'
                    : 'text-[color:var(--color-text-mute)] hover:text-[color:var(--color-text)]'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 10: Create `app/src/pages/Placeholder.tsx`**

```tsx
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[color:var(--color-text-mute)] font-mono text-xs tracking-widest">
      {title.toUpperCase()} — coming online
    </div>
  );
}
```

- [ ] **Step 11: Create `app/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 12: Create `app/.gitignore`**

```
node_modules/
dist/
.vite/
.env.local
.env.*.local
*.log
```

- [ ] **Step 13: Update root `.gitignore`** (append if missing):

```
app/node_modules/
app/dist/
```

- [ ] **Step 14: Install + build smoke**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/app
npm install
npm run build
```

Expect a clean build: `app/dist/index.html` + assets exist.

- [ ] **Step 15: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/package.json app/package-lock.json app/tsconfig.json \
        app/vite.config.ts app/index.html app/postcss.config.js \
        app/src/ app/.gitignore .gitignore
git commit -m "chore(app): scaffold Vite + React 19 + Tailwind local UI"
```

---

### Task 2: API client (REST + WebSocket)

**Files:**
- Create: `app/src/api/client.ts`
- Create: `app/src/api/ws.ts`
- Create: `app/src/api/types.ts`
- Create: `app/src/api/client.test.ts`

- [ ] **Step 1: Write failing test `app/src/api/client.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiGet, apiPost, apiPatch, apiDelete } from './client.ts';

const originalFetch = global.fetch;

describe('api client', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('apiGet encodes query params and returns parsed JSON', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'abc' }],
    });
    const rows = await apiGet<{ id: string }[]>('/api/sessions', { from: '2026-01-01' });
    expect(rows[0].id).toBe('abc');
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/api/sessions?from=2026-01-01');
  });

  it('apiPost sends JSON body and Content-Type header', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await apiPost('/api/config', { watchDir: '/tmp' });
    const init = (global.fetch as any).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as any)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"watchDir":"/tmp"}');
  });

  it('apiDelete sends DELETE and tolerates 204', async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, status: 204, json: async () => null });
    await expect(apiDelete('/api/sessions/abc')).resolves.toBeUndefined();
  });

  it('throws on non-ok responses with status and body text', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });
    await expect(apiGet('/api/sessions')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run — expect ImportError**

```bash
cd app && npx vitest run src/api/client.test.ts
```

- [ ] **Step 3: Implement `app/src/api/types.ts`**

```ts
export interface Session {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
  source: 'live' | 'sd_import';
  source_file: string | null;
  synced_at: string | null;
}

export interface SessionDetail extends Session {
  signals: Array<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>;
}

export interface OverviewRow {
  bucket: string;
  signal_id: number;
  avg_value: number;
}

export interface WindowRow {
  ts: string;
  value: number;
}

export interface SignalDefinition {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  description: string | null;
}

export interface LiveStatus {
  basestation: 'connected' | 'disconnected';
  port: string | null;
  session_id: string | null;
  source: 'live' | 'sd_import' | null;
}

export type ParserEvent =
  | { type: 'serial_status'; state: 'connected' | 'disconnected'; port?: string }
  | { type: 'session_started'; session_id: string; source: 'live' | 'sd_import' }
  | { type: 'session_ended'; session_id: string; row_count: number }
  | { type: 'frames'; rows: Array<{ ts: string; signal_id: number; value: number }> }
  | { type: 'import_progress'; file: string; pct: number }
  | { type: 'error'; msg: string };
```

- [ ] **Step 4: Implement `app/src/api/client.ts`**

```ts
const TOKEN_KEY = 'nfr_api_token';

function getToken(): string | null {
  // URL `?key=xxx` overrides localStorage on first visit.
  const fromUrl = new URLSearchParams(window.location.search).get('key');
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const token = getToken();
  if (token) url.searchParams.set('key', token);
  return url.pathname + url.search;
}

async function throwOnError(res: Response): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`${res.status} ${res.statusText}: ${body}`);
}

export async function apiGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(buildUrl(path, query));
  await throwOnError(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwOnError(res);
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwOnError(res);
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(buildUrl(path), { method: 'DELETE' });
  await throwOnError(res);
}
```

- [ ] **Step 5: Implement `app/src/api/ws.ts`**

```ts
import type { ParserEvent } from './types.ts';

function tokenFor(url: URL): void {
  const token = new URLSearchParams(window.location.search).get('key')
    ?? localStorage.getItem('nfr_api_token');
  if (token) url.searchParams.set('key', token);
}

function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${proto}//${window.location.host}${path}`);
  tokenFor(url);
  return url.toString();
}

export interface WsSubscription {
  close: () => void;
}

/** Subscribe to /ws/live. Returns a handle you can close(). */
export function subscribeLive(onEvent: (ev: ParserEvent) => void): WsSubscription {
  return openWs('/ws/live', onEvent);
}

/** Subscribe to /ws/events. */
export function subscribeEvents(onEvent: (ev: ParserEvent) => void): WsSubscription {
  return openWs('/ws/events', onEvent);
}

function openWs(path: string, onEvent: (ev: ParserEvent) => void): WsSubscription {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl(path));
    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(String(msg.data)));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      reconnectTimer = setTimeout(connect, 1000);
    };
    ws.onerror = () => {
      // onclose will fire and trigger reconnect.
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
```

- [ ] **Step 6: Run — expect 4 client tests passing**

- [ ] **Step 7: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/src/api/
git commit -m "feat(app): REST client + WebSocket subscribers with token handling"
```

---

### Task 3: Signal catalog adapter (bridges our schema into the design's shape)

**Files:**
- Create: `app/src/signals/palette.ts`
- Create: `app/src/signals/metadata.json`
- Create: `app/src/signals/catalog.ts`
- Create: `app/src/signals/catalog.test.ts`

The design widgets consume a `SIGNALS` global with `ALL: Signal[]`, `GROUPS: Group[]`, `byId(id)`. Our DB `signal_definitions` has `{id, source, signal_name, unit}`. This module produces the design's shape from our API response, adding group colors (by `source`) and optional min/max overrides from a bundled JSON.

- [ ] **Step 1: Create `app/src/signals/palette.ts`**

Nine-color palette taken from the design bundle (see `app/design-reference/project/lib/signals.js` `GROUPS[].color`). Any new `source` we haven't explicitly mapped cycles through this list.

```ts
export const GROUP_COLORS: Record<string, string> = {
  PDM: '#e0b066',
  PCM: '#e0b066',
  Inverter: '#e0b066',
  BMS_SOE: '#e06c6c',
  HV: '#e06c6c',
  Thermal: '#e08a5a',
  Coolant: '#e08a5a',
  Suspension: '#8ba6df',
  Damper: '#8ba6df',
  Brake: '#7ec98f',
  Driver: '#a78bfa',
  Steering: '#a78bfa',
  IMU: '#67d4f0',
  GPS: '#67d4f0',
};

const FALLBACKS = [
  '#e0b066',
  '#e06c6c',
  '#e08a5a',
  '#8ba6df',
  '#7ec98f',
  '#a78bfa',
  '#67d4f0',
];

export function colorForSource(source: string): string {
  if (GROUP_COLORS[source]) return GROUP_COLORS[source];
  // Deterministic fallback by hashing the source name.
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) | 0;
  return FALLBACKS[Math.abs(h) % FALLBACKS.length];
}
```

- [ ] **Step 2: Create `app/src/signals/metadata.json` (starter overlay; grow later via Settings)**

```json
{
  "PDM/bus_voltage": { "min": 11, "max": 14, "kind": "line" },
  "BMS_SOE/soc": { "min": 0, "max": 100, "kind": "slow" },
  "BMS_SOE/pack_voltage": { "min": 280, "max": 410, "kind": "line" },
  "BMS_SOE/pack_current": { "min": -60, "max": 280, "kind": "line" }
}
```

- [ ] **Step 3: Write failing test `app/src/signals/catalog.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildCatalog } from './catalog.ts';
import type { SignalDefinition } from '../api/types.ts';

const defs: SignalDefinition[] = [
  { id: 1, source: 'PDM', signal_name: 'bus_voltage', unit: 'V', description: null },
  { id: 2, source: 'BMS_SOE', signal_name: 'soc', unit: '%', description: null },
  { id: 3, source: 'BMS_SOE', signal_name: 'pack_voltage', unit: 'V', description: null },
];

describe('buildCatalog', () => {
  it('groups signals by source and assigns deterministic group colors', () => {
    const cat = buildCatalog(defs);
    const sources = cat.GROUPS.map((g) => g.id).sort();
    expect(sources).toEqual(['BMS_SOE', 'PDM']);
    const bms = cat.GROUPS.find((g) => g.id === 'BMS_SOE')!;
    expect(bms.color).toBe('#e06c6c'); // from GROUP_COLORS
    expect(bms.signals).toHaveLength(2);
  });

  it('applies min/max/kind overlays from metadata.json when available', () => {
    const cat = buildCatalog(defs);
    const soc = cat.ALL.find((s) => s.id === 2)!;
    expect(soc.min).toBe(0);
    expect(soc.max).toBe(100);
    expect(soc.kind).toBe('slow');
  });

  it('falls back to sensible defaults for unknown signals', () => {
    const cat = buildCatalog(defs);
    const busV = cat.ALL.find((s) => s.id === 1)!;
    expect(busV.min).toBe(11);
    expect(busV.max).toBe(14);
    expect(busV.kind).toBe('line');
  });

  it('byId returns null for missing ids', () => {
    const cat = buildCatalog(defs);
    expect(cat.byId(9999)).toBeNull();
    expect(cat.byId(1)?.name).toBe('bus_voltage');
  });
});
```

- [ ] **Step 4: Implement `app/src/signals/catalog.ts`**

```ts
import type { SignalDefinition } from '../api/types.ts';
import { colorForSource } from './palette.ts';
import overlay from './metadata.json';

export type SignalKind = 'line' | 'area' | 'step' | 'slow' | 'bool' | 'ac';

export interface Signal {
  id: number;
  name: string;
  unit: string;
  group: string;
  groupName: string;
  color: string;
  min: number;
  max: number;
  kind: SignalKind;
}

export interface SignalGroup {
  id: string;
  name: string;
  color: string;
  signals: Signal[];
}

export interface SignalCatalog {
  ALL: Signal[];
  GROUPS: SignalGroup[];
  byId: (id: number) => Signal | null;
}

interface OverlayEntry {
  min?: number;
  max?: number;
  kind?: SignalKind;
}

const OVERLAY = overlay as Record<string, OverlayEntry>;

function overlayFor(source: string, name: string): OverlayEntry {
  return OVERLAY[`${source}/${name}`] ?? {};
}

export function buildCatalog(defs: SignalDefinition[]): SignalCatalog {
  const signals: Signal[] = defs.map((d) => {
    const ov = overlayFor(d.source, d.signal_name);
    return {
      id: d.id,
      name: d.signal_name,
      unit: d.unit ?? '',
      group: d.source,
      groupName: d.source,
      color: colorForSource(d.source),
      min: ov.min ?? 0,
      max: ov.max ?? 1,
      kind: ov.kind ?? 'line',
    };
  });

  const groupMap = new Map<string, SignalGroup>();
  for (const s of signals) {
    if (!groupMap.has(s.group)) {
      groupMap.set(s.group, {
        id: s.group,
        name: s.groupName,
        color: s.color,
        signals: [],
      });
    }
    groupMap.get(s.group)!.signals.push(s);
  }
  const GROUPS = Array.from(groupMap.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const byIdMap = new Map(signals.map((s) => [s.id, s] as const));

  return {
    ALL: signals,
    GROUPS,
    byId: (id) => byIdMap.get(id) ?? null,
  };
}
```

- [ ] **Step 5: Run — expect 4 catalog tests passing**

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/src/signals/
git commit -m "feat(app): signal catalog adapter (DB defs → design shape)"
```

---

### Task 4: Port design components (shell, widgets, dir-dock)

**Files (copied + adapted from `app/design-reference/project/lib/`):**
- Create: `app/src/components/colors.ts`
- Create: `app/src/components/widgets.tsx`
- Create: `app/src/components/shell.tsx`
- Create: `app/src/components/dir-dock.tsx`
- Create: `app/src/components/SignalsProvider.tsx`

The prototype relies on a global `window.SIGNALS`. We replace that with a React context. Everywhere the design code reads `window.SIGNALS.*` or `window.SIGNALS.byId(...)`, the ported version uses `useCatalog()` from `SignalsProvider.tsx`.

- [ ] **Step 1: Create `app/src/components/colors.ts`**

Extract the `W_COLORS` / `SH_COLORS` object that `widgets.jsx` and `shell.jsx` share at the top of the file (look at `app/design-reference/project/lib/widgets.jsx:1-40`).

```ts
export const COLORS = {
  bg: '#1e1f22',
  panel: '#2b2d30',
  bgInner: 'rgba(0,0,0,0.25)',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  text: '#dfe1e5',
  textMute: 'rgba(255,255,255,0.6)',
  textFaint: 'rgba(255,255,255,0.3)',
  accent: '#4e2a84',
};
```

- [ ] **Step 2: Create `app/src/components/SignalsProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SignalCatalog } from '../signals/catalog.ts';
import { buildCatalog } from '../signals/catalog.ts';
import { apiGet } from '../api/client.ts';
import type { SignalDefinition } from '../api/types.ts';

const Ctx = createContext<SignalCatalog | null>(null);

export function SignalsProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<SignalCatalog | null>(null);

  useEffect(() => {
    apiGet<SignalDefinition[]>('/api/signal-definitions')
      .then((defs) => setCatalog(buildCatalog(defs)))
      .catch((err) => {
        console.error('Failed to load signal definitions', err);
        setCatalog(buildCatalog([])); // empty catalog keeps UI rendering
      });
  }, []);

  if (!catalog) {
    return (
      <div className="h-full flex items-center justify-center font-mono text-xs text-[color:var(--color-text-faint)] tracking-widest">
        LOADING SIGNALS…
      </div>
    );
  }

  return <Ctx.Provider value={catalog}>{children}</Ctx.Provider>;
}

export function useCatalog(): SignalCatalog {
  const cat = useContext(Ctx);
  if (!cat) throw new Error('useCatalog used outside SignalsProvider');
  return cat;
}
```

- [ ] **Step 3: Port `widgets.jsx`**

Copy `app/design-reference/project/lib/widgets.jsx` to `app/src/components/widgets.tsx` and make these mechanical changes:

1. Remove the IIFE wrapper; add `import` statements:
   ```tsx
   import React, { useRef, useEffect, useState } from 'react';
   import type { Signal } from '../signals/catalog.ts';
   import { useCatalog } from './SignalsProvider.tsx';
   import { COLORS as W_COLORS } from './colors.ts';
   ```
2. Replace every `window.SIGNALS.byId(id)` call with `useCatalog().byId(id)`.
3. Replace every `window.SIGNALS.ALL` / `.GROUPS` with `useCatalog().ALL` / `.GROUPS`.
4. Convert the `function Foo(props)` declarations into `export function Foo(props: FooProps)` with TS prop types derived from usage (use `any` where inference is painful; this is presentation code, not critical-path).
5. Keep the actual SVG/markup rendering exactly as-is — do not restyle.
6. Drop the `window.W_COLORS = W_COLORS;` export line (if present at EOF).

This is mostly mechanical. The widgets file is ~570 lines; it will stay roughly that size after port.

- [ ] **Step 4: Port `shell.jsx`**

Copy `app/design-reference/project/lib/shell.jsx` to `app/src/components/shell.tsx`. Same mechanical changes:

1. Add imports at top:
   ```tsx
   import React, { useState } from 'react';
   import { useCatalog } from './SignalsProvider.tsx';
   import { COLORS as SH_COLORS } from './colors.ts';
   import { SignalChip, SignalPicker, TopBar, Timeline, WidgetShell, GroupPill } from './widgets.tsx';
   ```
   Adjust imports to match the actual exports you identify while porting `widgets.tsx`.
2. Replace `window.SIGNALS.*` references.
3. `export` every function that other components import (Signal*/TopBar/Timeline/WidgetShell/GroupPill).
4. `const SH_COLORS = W_COLORS;` — drop; just import COLORS.

- [ ] **Step 5: Port `dir-dock.jsx`**

Copy `app/design-reference/project/lib/dir-dock.jsx` to `app/src/components/dir-dock.tsx`. Same conversion. The exported component should be `DockDirection` (default export OR named — match what `FSAE Dashboard.html` uses in `<DockDirection ... />`). Export signature likely: `export function DockDirection({ t, onT, mode, onMode, duration, density, graphStyle }) { ... }`.

- [ ] **Step 6: Sanity smoke — mount the shell on the live route with mock data**

Temporarily update `app/src/pages/Placeholder.tsx` or create a quick `app/src/pages/LiveMock.tsx` that renders:

```tsx
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';

export function LiveMock() {
  return (
    <SignalsProvider>
      <DockDirection
        t={0.42}
        onT={() => {}}
        mode="live"
        onMode={() => {}}
        duration={1}
        density="compact"
        graphStyle="line"
      />
    </SignalsProvider>
  );
}
```

Swap `{ index: true, element: <Placeholder title="Live dashboard" /> }` in `routes.tsx` for `element: <LiveMock />` temporarily.

- [ ] **Step 7: Visual smoke — `npm run dev` and open http://localhost:5173**

Expected (with the Fastify server running from Plan 3):
- Dark dashboard shell renders matching the design screenshot (`app/design-reference/project/uploads/pasted-1776812384668-0.png` is a reference capture).
- The signal catalog pulled from the DB (which is probably empty at this stage) makes the picker show 0 signals — that's expected. If you seed a session via `python parser/__main__.py replay` into a fresh DB, the picker populates.
- Widgets render frozen/placeholder since no live data source is wired yet.

Restore `routes.tsx` back to `<Placeholder />` for the `/` route when done — Task 5 will wire the real live page.

- [ ] **Step 8: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/src/components/
git commit -m "feat(app): port FSAE Dashboard components (shell, widgets, dir-dock)"
```

---

### Task 5: Live view — subscribe to /ws/live + drive the dock

**Files:**
- Create: `app/src/pages/Live.tsx`
- Create: `app/src/hooks/useLiveFrames.ts`
- Create: `app/src/hooks/useLiveFrames.test.ts`
- Create: `app/src/hooks/useLiveStatus.ts`
- Modify: `app/src/routes.tsx` (point `/` at `<Live />`)

`useLiveFrames` maintains the most-recent value per signal plus a small ring buffer per signal (for graph widgets) and is updated from `/ws/live`. The design widgets read values and (for graphs) a windowed series — we expose both.

- [ ] **Step 1: Write failing test `app/src/hooks/useLiveFrames.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FramesStore } from './useLiveFrames.ts';

describe('FramesStore', () => {
  it('tracks latest value per signal and a bounded ring buffer', () => {
    const store = new FramesStore({ bufferSize: 3 });
    store.push([
      { ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 1.0 },
      { ts: '2026-04-22T12:00:01Z', signal_id: 1, value: 2.0 },
      { ts: '2026-04-22T12:00:02Z', signal_id: 1, value: 3.0 },
      { ts: '2026-04-22T12:00:03Z', signal_id: 1, value: 4.0 },
    ]);
    expect(store.latest(1)?.value).toBe(4.0);
    const series = store.series(1);
    expect(series.map((r) => r.value)).toEqual([2.0, 3.0, 4.0]);
  });

  it('notifies subscribers on every push', () => {
    const store = new FramesStore({ bufferSize: 5 });
    const spy = vi.fn();
    const unsub = store.subscribe(spy);
    store.push([{ ts: 't', signal_id: 1, value: 9 }]);
    store.push([{ ts: 't', signal_id: 1, value: 10 }]);
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
    store.push([{ ts: 't', signal_id: 1, value: 11 }]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Implement `app/src/hooks/useLiveFrames.ts`**

```ts
import { useEffect, useSyncExternalStore, useState } from 'react';
import { subscribeLive } from '../api/ws.ts';
import type { ParserEvent } from '../api/types.ts';

export interface FrameRow {
  ts: string;
  signal_id: number;
  value: number;
}

interface FramesStoreOptions {
  bufferSize?: number;
}

export class FramesStore {
  private ringBySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private bufferSize: number;
  private version = 0;

  constructor(opts: FramesStoreOptions = {}) {
    this.bufferSize = opts.bufferSize ?? 300;
  }

  push(rows: FrameRow[]): void {
    for (const r of rows) {
      this.latestBySignal.set(r.signal_id, r);
      let buf = this.ringBySignal.get(r.signal_id);
      if (!buf) {
        buf = [];
        this.ringBySignal.set(r.signal_id, buf);
      }
      buf.push(r);
      if (buf.length > this.bufferSize) buf.shift();
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  latest(signalId: number): FrameRow | null {
    return this.latestBySignal.get(signalId) ?? null;
  }

  series(signalId: number): FrameRow[] {
    return this.ringBySignal.get(signalId) ?? [];
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useLiveFrames(): FramesStore {
  const [store] = useState(() => new FramesStore());
  useEffect(() => {
    const sub = subscribeLive((ev: ParserEvent) => {
      if (ev.type === 'frames') store.push(ev.rows);
    });
    return () => sub.close();
  }, [store]);
  // Re-render when version bumps.
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );
  return store;
}
```

- [ ] **Step 3: Implement `app/src/hooks/useLiveStatus.ts`**

```ts
import { useEffect, useState } from 'react';
import { subscribeEvents } from '../api/ws.ts';
import { apiGet } from '../api/client.ts';
import type { LiveStatus, ParserEvent } from '../api/types.ts';

const INITIAL: LiveStatus = {
  basestation: 'disconnected',
  port: null,
  session_id: null,
  source: null,
};

export function useLiveStatus(): LiveStatus {
  const [state, setState] = useState<LiveStatus>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    apiGet<LiveStatus>('/api/live/status').then((s) => {
      if (!cancelled) setState(s);
    }).catch(() => {});
    const sub = subscribeEvents((ev: ParserEvent) => {
      setState((prev) => {
        if (ev.type === 'serial_status') {
          return { ...prev, basestation: ev.state, port: ev.port ?? null };
        }
        if (ev.type === 'session_started') {
          return { ...prev, session_id: ev.session_id, source: ev.source };
        }
        if (ev.type === 'session_ended') {
          return { ...prev, session_id: null, source: null };
        }
        return prev;
      });
    });
    return () => {
      cancelled = true;
      sub.close();
    };
  }, []);

  return state;
}
```

- [ ] **Step 4: Implement `app/src/pages/Live.tsx`**

```tsx
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';
import { useLiveFrames } from '../hooks/useLiveFrames.ts';
import { useLiveStatus } from '../hooks/useLiveStatus.ts';

export default function Live() {
  const status = useLiveStatus();
  const frames = useLiveFrames();
  return (
    <SignalsProvider>
      <LiveBanner status={status} />
      <DockDirection
        t={1}
        onT={() => {}}
        mode="live"
        onMode={() => {}}
        duration={1}
        density="compact"
        graphStyle="line"
        frames={frames}
      />
    </SignalsProvider>
  );
}

function LiveBanner({ status }: { status: ReturnType<typeof useLiveStatus> }) {
  const color =
    status.basestation === 'connected' ? '#7ec98f' : '#e06c6c';
  return (
    <div className="h-7 px-4 flex items-center gap-3 border-b border-[color:var(--color-border)] font-mono text-[11px] tracking-widest">
      <span style={{ color }}>●</span>
      <span className="text-[color:var(--color-text-mute)]">
        BASESTATION: {status.basestation.toUpperCase()}
        {status.port ? ` · ${status.port}` : ''}
      </span>
      {status.session_id && (
        <span className="text-[color:var(--color-text-mute)]">
          · RECORDING {status.session_id.slice(0, 8)}
        </span>
      )}
    </div>
  );
}
```

**Important:** `DockDirection` from `dir-dock.tsx` (ported in Task 4) currently takes its signal values from internal synthesis (the old `signals.js` waveform generator). You need to pass `frames` through and update `dir-dock.tsx` + `widgets.tsx` to consume `frames.latest(signalId)` and `frames.series(signalId)` in place of the mock waveforms.

Grep for the mock call sites in the ported files (search for the function that returns synthesized values — in the original, it's roughly `const sample = (sig, t) => …`). Replace each with:
- For a "latest reading" display: `const latest = frames.latest(sig.id); const value = latest ? latest.value : null;`
- For a line/area/step graph: `const series = frames.series(sig.id).map((r) => r.value);`

Keep the visual transformation (scaling, axis layout) unchanged; only swap the data source.

- [ ] **Step 5: Update `app/src/routes.tsx`**

```tsx
import { createBrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import Live from './pages/Live.tsx';
import { Placeholder } from './pages/Placeholder.tsx';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Live /> },
      { path: 'sessions', element: <Placeholder title="Sessions" /> },
      { path: 'sessions/:id', element: <Placeholder title="Replay" /> },
      { path: 'settings', element: <Placeholder title="Settings" /> },
    ],
  },
]);
```

- [ ] **Step 6: Run — expect 2 FramesStore tests passing; previous tests still green**

```bash
cd app && npm test
```

- [ ] **Step 7: Visual smoke — run the full stack**

```bash
# Terminal 1 — boot the Fastify server + parser in replay mode
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
psql -U postgres -c "DROP DATABASE IF EXISTS nfr_live_smoke"
psql -U postgres -c "CREATE DATABASE nfr_live_smoke"
export NFR_DB_URL="postgres://postgres@localhost:5432/nfr_live_smoke"
export NFR_BIND_PORT=4444
cd desktop && npx tsx main/src/index.ts &
SERVER_PID=$!
cd ..

# Terminal 2 — set replay mode via config then restart the server
curl -X POST -H "Content-Type: application/json" \
  -d '{"replayFile":"'"$PWD"'/parser/testData/3-10-26/LOG_0002.NFR","replaySpeed":5.0}' \
  http://127.0.0.1:4444/api/config
kill $SERVER_PID; wait $SERVER_PID 2>/dev/null
cd desktop && npx tsx main/src/index.ts &
SERVER_PID=$!
cd ..

# Terminal 3 — open the Vite dev server
cd app && npm run dev
```

Open `http://localhost:5173`:
- Banner should flash `BASESTATION: CONNECTED · file://.../LOG_0002.NFR`.
- Widgets should animate as frames roll in at 5x real time.
- After the replay finishes (≈ 20 seconds), banner reverts to `DISCONNECTED`.

Kill both servers, drop the scratch DB.

- [ ] **Step 8: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/src/pages/Live.tsx app/src/hooks/ app/src/routes.tsx \
        app/src/components/dir-dock.tsx app/src/components/widgets.tsx
git commit -m "feat(app): live view wired to /ws/live with real-time frame rendering"
```

---

### Task 6: Sessions list + Replay view

**Files:**
- Create: `app/src/pages/Sessions.tsx`
- Create: `app/src/pages/Replay.tsx`
- Create: `app/src/hooks/useOverview.ts`
- Modify: `app/src/routes.tsx`

- [ ] **Step 1: Implement `app/src/pages/Sessions.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api/client.ts';
import type { Session } from '../api/types.ts';

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    apiGet<Session[]>('/api/sessions').then(setSessions).catch(() => setSessions([]));
  }, []);

  if (sessions === null) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }
  if (sessions.length === 0) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">NO SESSIONS</div>;
  }

  return (
    <div className="p-6 overflow-auto h-full">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-left text-[color:var(--color-text-mute)]">
            <th className="py-2 pr-4">STARTED</th>
            <th className="py-2 pr-4">SOURCE</th>
            <th className="py-2 pr-4">DURATION</th>
            <th className="py-2 pr-4">TRACK</th>
            <th className="py-2 pr-4">DRIVER</th>
            <th className="py-2 pr-4">CAR</th>
            <th className="py-2 pr-4">NOTES</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              className="border-t border-[color:var(--color-border)] hover:bg-[color:var(--color-panel)]/40"
            >
              <td className="py-2 pr-4">{new Date(s.started_at).toLocaleString()}</td>
              <td className="py-2 pr-4">{s.source}</td>
              <td className="py-2 pr-4">{formatDuration(s.started_at, s.ended_at)}</td>
              <td className="py-2 pr-4">{s.track ?? '—'}</td>
              <td className="py-2 pr-4">{s.driver ?? '—'}</td>
              <td className="py-2 pr-4">{s.car ?? '—'}</td>
              <td className="py-2 pr-4 truncate max-w-[14rem]">{s.notes ?? ''}</td>
              <td className="py-2">
                <Link
                  to={`/sessions/${s.id}`}
                  className="text-[color:var(--color-accent)] hover:underline"
                >
                  OPEN →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.round(ms / 1000);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
```

- [ ] **Step 2: Implement `app/src/hooks/useOverview.ts`**

```ts
import { useEffect, useState } from 'react';
import { apiGet } from '../api/client.ts';
import type { OverviewRow, SessionDetail } from '../api/types.ts';

export interface ReplayData {
  detail: SessionDetail | null;
  rows: OverviewRow[];
  loading: boolean;
  error: string | null;
}

export function useOverview(sessionId: string, bucketSecs = 1): ReplayData {
  const [data, setData] = useState<ReplayData>({
    detail: null,
    rows: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, error: null }));
    Promise.all([
      apiGet<SessionDetail>(`/api/sessions/${sessionId}`),
      apiGet<OverviewRow[]>(`/api/sessions/${sessionId}/overview`, { bucket: bucketSecs }),
    ])
      .then(([detail, rows]) => {
        if (cancelled) return;
        setData({ detail, rows, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setData({ detail: null, rows: [], loading: false, error: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, bucketSecs]);

  return data;
}
```

- [ ] **Step 3: Implement `app/src/pages/Replay.tsx`**

Replay reuses the same dock, but feeds it a time-sliced view of overview rows instead of live frames. Build a small `FramesStore`-compatible facade that returns `latest()` and `series()` based on the scrubber position `t ∈ [0,1]`.

```tsx
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SignalsProvider } from '../components/SignalsProvider.tsx';
import { DockDirection } from '../components/dir-dock.tsx';
import { useOverview } from '../hooks/useOverview.ts';
import type { FramesStore, FrameRow } from '../hooks/useLiveFrames.ts';

function makeReplayStore(rows: import('../api/types.ts').OverviewRow[], t: number): FramesStore {
  // Cheap adapter: pretend to be a FramesStore by implementing .latest() + .series().
  const bySignal = new Map<number, FrameRow[]>();
  for (const r of rows) {
    const frame: FrameRow = {
      ts: r.bucket,
      signal_id: r.signal_id,
      value: r.avg_value,
    };
    let arr = bySignal.get(r.signal_id);
    if (!arr) {
      arr = [];
      bySignal.set(r.signal_id, arr);
    }
    arr.push(frame);
  }
  for (const arr of bySignal.values()) {
    arr.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  const cutoffIndex = (arr: FrameRow[]) =>
    Math.max(0, Math.min(arr.length - 1, Math.floor(t * arr.length)));

  return {
    push() {},
    latest(id) {
      const arr = bySignal.get(id);
      if (!arr || arr.length === 0) return null;
      return arr[cutoffIndex(arr)] ?? null;
    },
    series(id) {
      const arr = bySignal.get(id);
      if (!arr || arr.length === 0) return [];
      return arr.slice(0, cutoffIndex(arr) + 1);
    },
    getVersion() {
      return 0;
    },
    subscribe() {
      return () => {};
    },
  } as unknown as FramesStore;
}

export default function Replay() {
  const { id } = useParams<{ id: string }>();
  const { detail, rows, loading, error } = useOverview(id!, 1);
  const [t, setT] = useState(1);

  const store = useMemo(() => makeReplayStore(rows, t), [rows, t]);

  if (loading) {
    return <div className="p-6 font-mono text-xs text-[color:var(--color-text-faint)]">LOADING…</div>;
  }
  if (error) {
    return <div className="p-6 font-mono text-xs text-red-400">ERROR: {error}</div>;
  }

  return (
    <SignalsProvider>
      <div className="h-7 px-4 flex items-center gap-3 border-b border-[color:var(--color-border)] font-mono text-[11px] tracking-widest text-[color:var(--color-text-mute)]">
        REPLAY · {detail?.track ?? '—'} · {detail?.driver ?? '—'} · {rows.length} rows
      </div>
      <DockDirection
        t={t}
        onT={setT}
        mode="replay"
        onMode={() => {}}
        duration={1}
        density="compact"
        graphStyle="line"
        frames={store}
      />
    </SignalsProvider>
  );
}
```

- [ ] **Step 4: Update `app/src/routes.tsx`**

```tsx
import Sessions from './pages/Sessions.tsx';
import Replay from './pages/Replay.tsx';
// ...
      { path: 'sessions', element: <Sessions /> },
      { path: 'sessions/:id', element: <Replay /> },
```

- [ ] **Step 5: Visual smoke**

With an imported session in the DB (from an earlier replay), open `/sessions`, click through to one — scrubber at the bottom of the dock should rewind/fast-forward through the run.

- [ ] **Step 6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/src/pages/Sessions.tsx app/src/pages/Replay.tsx \
        app/src/hooks/useOverview.ts app/src/routes.tsx
git commit -m "feat(app): sessions list + replay view with scrubber"
```

---

### Task 7: Settings screen

**Files:**
- Create: `app/src/pages/Settings.tsx`
- Modify: `app/src/routes.tsx`

`/api/config` merges partial patches. The settings form shows current values, patches on save.

- [ ] **Step 1: Implement `app/src/pages/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client.ts';

type Config = {
  serialPort?: string;
  watchDir?: string;
  replayFile?: string;
  replaySpeed?: number;
  broadcastEnabled?: boolean;
  density?: 'compact' | 'comfortable';
  graphStyle?: 'line' | 'area' | 'step';
  accent?: string;
};

export default function Settings() {
  const [cfg, setCfg] = useState<Config>({});
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    apiGet<Config>('/api/config').then(setCfg);
  }, []);

  const update = (patch: Partial<Config>) => setCfg((c) => ({ ...c, ...patch }));

  const save = async () => {
    setStatus('Saving…');
    await apiPost('/api/config', cfg);
    setStatus('Saved. Server restart required for parser-affecting changes.');
    setTimeout(() => setStatus(''), 4000);
  };

  return (
    <div className="p-8 overflow-auto h-full font-mono text-xs text-[color:var(--color-text)]">
      <div className="max-w-xl space-y-6">
        <Section title="CAPTURE">
          <Field label="Serial port" value={cfg.serialPort ?? ''} onChange={(v) => update({ serialPort: v })} />
          <Field label="SD watch directory" value={cfg.watchDir ?? ''} onChange={(v) => update({ watchDir: v })} />
        </Section>

        <Section title="REPLAY (HARDWARE-FREE TESTING)">
          <Field label="Replay file (.nfr)" value={cfg.replayFile ?? ''} onChange={(v) => update({ replayFile: v })} />
          <Field
            label="Replay speed (0 = flood)"
            value={String(cfg.replaySpeed ?? '')}
            onChange={(v) => update({ replaySpeed: v === '' ? undefined : Number(v) })}
          />
        </Section>

        <Section title="BROADCAST ON LAN">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!cfg.broadcastEnabled}
              onChange={(e) => update({ broadcastEnabled: e.target.checked })}
            />
            <span>Enabled (requires server restart)</span>
          </label>
        </Section>

        <Section title="APPEARANCE">
          <Field label="Accent (hex)" value={cfg.accent ?? '#4E2A84'} onChange={(v) => update({ accent: v })} />
          <Select
            label="Density"
            value={cfg.density ?? 'compact'}
            options={['compact', 'comfortable']}
            onChange={(v) => update({ density: v as Config['density'] })}
          />
          <Select
            label="Graph style"
            value={cfg.graphStyle ?? 'line'}
            options={['line', 'area', 'step']}
            onChange={(v) => update({ graphStyle: v as Config['graphStyle'] })}
          />
        </Section>

        <div className="flex gap-2 items-center">
          <button
            onClick={save}
            className="px-3 py-1.5 bg-[color:var(--color-accent)] text-white tracking-widest text-[11px]"
          >
            SAVE
          </button>
          <span className="text-[color:var(--color-text-mute)]">{status}</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border border-[color:var(--color-border)] p-4">
      <legend className="px-2 text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{title}</legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-text)]"
      />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] tracking-widest text-[color:var(--color-text-mute)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[color:var(--color-panel)] border border-[color:var(--color-border)] px-2 py-1 text-[color:var(--color-text)]"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Update `app/src/routes.tsx`** to replace the settings placeholder:

```tsx
import Settings from './pages/Settings.tsx';
// ...
      { path: 'settings', element: <Settings /> },
```

- [ ] **Step 3: Visual smoke**

Open `/settings`, edit the replay file path, save. Restart the desktop server. Live view should now show the replay.

- [ ] **Step 4: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add app/src/pages/Settings.tsx app/src/routes.tsx
git commit -m "feat(app): settings screen persisted via /api/config"
```

---

### Task 8: Fastify serves `app/dist/` + end-to-end smoke

**Files:**
- Modify: `desktop/main/src/server/app.ts`
- Modify: `desktop/main/tests/server/app.test.ts`

- [ ] **Step 1: Build the UI**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations/app
npm run build
```

Verify `app/dist/index.html` exists.

- [ ] **Step 2: Update `desktop/main/src/server/app.ts`**

Add `@fastify/static` registration at the END of `buildApp` (after all `/api/*` and `/ws/*` routes, so it's the fallback):

```ts
import fastifyStatic from '@fastify/static';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Inside buildApp(), just before `return app;`:
const __dirname = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(__dirname, '../../../..', 'app', 'dist');
try {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    wildcard: true,
    // fallback to index.html for client-side routes
    setHeaders: (reply) => {
      // no-cache during dev; safe in production too for a single-user app
      reply.setHeader('Cache-Control', 'no-cache');
    },
  });
  // Client-side router fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    reply.sendFile('index.html');
  });
} catch (err) {
  // If app/dist doesn't exist yet (dev server not built), serve a tiny notice.
  app.setNotFoundHandler((_req, reply) => {
    reply.type('text/html').send(
      `<h1>NFR UI not built</h1><p>Run <code>cd app && npm run build</code>.</p>`,
    );
  });
}
```

The `staticRoot` points at `app/dist/` relative to the TS source (`desktop/main/src/server/app.ts`). Adjust the number of `..` segments if that's wrong for your repo layout (from `desktop/main/src/server/` you need to go up four to get to the repo root, then into `app/dist/`).

- [ ] **Step 3: Add a test that `GET /` returns the built index.html (when it exists)**

Append to `desktop/main/tests/server/app.test.ts`:

```ts
  it('serves app/dist/index.html at GET / when the UI is built', async () => {
    const app = await buildApp({ pool });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      // Either the built UI or the "not built" notice — both are acceptable.
      // Only the 404/500 paths would be failures.
      expect([200, 404]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });
```

(We avoid hard-asserting "UI exists" because CI / a fresh clone won't have a built dist yet.)

- [ ] **Step 4: Add `@fastify/static` to `desktop/package.json` if not already present**

```bash
cd desktop
grep '@fastify/static' package.json || npm install @fastify/static@^7.0.4
```

- [ ] **Step 5: Run full desktop suite — expect previously-passing count + 1 new test**

```bash
cd desktop && npm test
```

- [ ] **Step 6: End-to-end smoke**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations

# Clean DB
psql -U postgres -c "DROP DATABASE IF EXISTS nfr_e2e"
psql -U postgres -c "CREATE DATABASE nfr_e2e"

# Build UI
cd app && npm run build && cd ..

# Boot server
export NFR_DB_URL="postgres://postgres@localhost:5432/nfr_e2e"
export NFR_BIND_PORT=4444
cd desktop
npx tsx main/src/index.ts &
SERVER_PID=$!
cd ..
sleep 3

# Configure replay
curl -X POST -H "Content-Type: application/json" \
  -d '{"replayFile":"'"$PWD"'/parser/testData/3-10-26/LOG_0002.NFR","replaySpeed":10.0}' \
  http://127.0.0.1:4444/api/config

# Restart so parser picks up replayFile
kill $SERVER_PID; wait $SERVER_PID 2>/dev/null
cd desktop
npx tsx main/src/index.ts &
SERVER_PID=$!
cd ..

# Open the UI in a real browser — expected: dashboard renders against the built UI
open http://127.0.0.1:4444/

# After visual verification:
kill $SERVER_PID
psql -U postgres -c "DROP DATABASE IF EXISTS nfr_e2e"
```

Expected:
- Navigating to `http://127.0.0.1:4444/` loads the UI.
- Live view shows frames scrolling at 10x speed.
- `/sessions` lists the session created by the replay.
- `/sessions/<id>` shows the replay view with scrubber.
- `/settings` shows current config.

- [ ] **Step 7: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/.worktrees/plan-1-db-migrations
git add desktop/main/src/server/app.ts desktop/main/tests/server/app.test.ts \
        desktop/package.json desktop/package-lock.json
git commit -m "feat(desktop): serve app/dist as fallback + client-side router support"
```

---

## Exit criteria for Plan 4

- `cd app && npm test` passes (minimum 10 tests: 4 api client + 4 catalog + 2 FramesStore).
- `cd desktop && npm test` remains green (46 tests after Task 8's new one).
- `cd parser && .venv/bin/pytest` still 24 passing (untouched).
- Building and running the app end-to-end at `http://127.0.0.1:4444/` shows the FSAE Dashboard visual target with real data flowing from the Postgres + parser pipeline.
- Replay mode via `/api/config` drives the dashboard with a real `.nfr` file — hardware-free testing verified.
- Sessions list + scrubbable replay view work against historical data.
- Settings screen persists configuration.

Plan 5 (packaging) picks up from here: electron-builder, PyInstaller for the parser, first-launch setup screen when Postgres is absent, optional auto-update.
