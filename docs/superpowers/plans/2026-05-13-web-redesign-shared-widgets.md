# Web Redesign with Shared Widgets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo into an npm-workspace monorepo with a shared `@nfr/widgets` package, then redesign the website (`frontend/interface/`) to use the desktop's dock UX backed by optimized Supabase RPCs.

**Architecture:** New `packages/widgets/` package owns all widget renderers, the dock layout, and chrome. Each app provides a thin "adapter" that fills `FramesContext` and `SignalsContext` from its own data source: desktop uses WebSocket → embedded Postgres; website uses Supabase RPCs (`get_signals_window`, `list_sessions`). Replay-only on the website for v1.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, npm workspaces, Supabase (PostgREST + RPCs), Postgres (sd_readings partitioned by month).

**Spec:** `docs/superpowers/specs/2026-05-13-web-redesign-shared-widgets-design.md`

---

## File structure

**New files:**

```
package.json                                              ← root workspace config
packages/widgets/package.json
packages/widgets/tsconfig.json
packages/widgets/vitest.config.ts
packages/widgets/src/index.ts                             ← barrel
packages/widgets/src/data/types.ts                        ← FrameRow, FramesStore, SignalDefinition, SignalCatalog
packages/widgets/src/data/contexts.tsx                    ← FramesContext, SignalsContext, useFrames, useCatalog
packages/widgets/src/theme/colors.ts                      ← moved from app
packages/widgets/src/widgets/                             ← moved from app
packages/widgets/src/dock/dir-dock.tsx                    ← moved from app
packages/widgets/src/chrome/                              ← TopBar, SignalChip, GroupPill, Timeline (split out)
packages/widgets/src/dock/compactVertical.test.ts
packages/widgets/test-setup.ts

desktop/migrations/0003_get_signals_window.sql
desktop/migrations/0004_list_sessions.sql

frontend/interface/src/adapters/bucketFor.ts
frontend/interface/src/adapters/bucketFor.test.ts
frontend/interface/src/adapters/SupabaseFramesStore.ts
frontend/interface/src/adapters/SupabaseFramesStore.test.ts
frontend/interface/src/adapters/useSupabaseFrames.ts
frontend/interface/src/adapters/useSupabaseCatalog.ts
frontend/interface/src/adapters/useSessionList.ts
frontend/interface/src/routes/AppDevRoute.jsx
frontend/interface/src/routes/AppRoute.jsx
```

**Modified files:**

```
app/package.json                          ← add @nfr/widgets workspace dep
app/src/components/widgets.tsx            ← deleted (moved to package)
app/src/components/dir-dock.tsx           ← deleted
app/src/components/shell.tsx              ← deleted
app/src/components/colors.ts              ← deleted
app/src/components/FramesContext.tsx      ← deleted
app/src/components/SignalsProvider.tsx    ← thin adapter on top of shared
app/src/hooks/useLiveFrames.ts            ← implements FramesStore interface
app/src/App.tsx (or main.tsx)             ← wraps in shared providers

frontend/interface/package.json           ← add @nfr/widgets, drop unused
frontend/interface/src/App.jsx            ← add /app and /app-dev routes
frontend/interface/vercel.json            ← add 301s (cutover task)
frontend/interface/src/pages/Home.jsx     ← reskin
frontend/interface/src/pages/AppDownload.jsx ← reskin
```

---

## Task 1: Add npm workspaces config (no code move yet)

**Files:**
- Create: `package.json` (repo root — replaces existing electron-only file)
- Modify: existing root `package.json` (back up first)

- [ ] **Step 1.1: Inspect existing root package.json**

Run: `cat /Users/andrewxue/Documents/daq-interface-26/package.json`

Note the existing fields. The new file must keep `"main": "main/main.js"`, `"scripts.start": "electron ."`, the electron deps, etc. We're adding `"workspaces"` and a `"private": true` flag.

- [ ] **Step 1.2: Rewrite root package.json with workspaces**

Open the existing file and add (between `"version"` and `"scripts"`):

```json
"private": true,
"workspaces": [
  "packages/*",
  "app",
  "frontend/interface",
  "desktop"
],
```

Keep every other field as-is. The file should still describe the electron app at the root level.

- [ ] **Step 1.3: Reinstall to pick up workspaces**

Run from the repo root: `npm install`

Expected: completes without errors. New top-level `node_modules/` may include symlinks for any future workspace packages, but with no `packages/*` yet it should just be a normal install.

- [ ] **Step 1.4: Verify all three apps still build**

Run in sequence:
```bash
cd /Users/andrewxue/Documents/daq-interface-26/app && npm run build
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface && npm run build
cd /Users/andrewxue/Documents/daq-interface-26/desktop && npm run typecheck
```

Expected: all three succeed.

- [ ] **Step 1.5: Verify all three test suites still pass**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/app && npm test
cd /Users/andrewxue/Documents/daq-interface-26/desktop && npm test
```

Expected: green. (Frontend has no tests configured yet; skip.)

- [ ] **Step 1.6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add package.json package-lock.json
git commit -m "monorepo: enable npm workspaces"
```

---

## Task 2: Scaffold empty `@nfr/widgets` package

**Files:**
- Create: `packages/widgets/package.json`
- Create: `packages/widgets/tsconfig.json`
- Create: `packages/widgets/vitest.config.ts`
- Create: `packages/widgets/src/index.ts`
- Create: `packages/widgets/test-setup.ts`

- [ ] **Step 2.1: Create `packages/widgets/package.json`**

```json
{
  "name": "@nfr/widgets",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./data": "./src/data/index.ts",
    "./theme": "./src/theme/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.2",
    "@vitejs/plugin-react": "^5.1.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2.2: Create `packages/widgets/tsconfig.json`**

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
  "include": ["src/**/*"]
}
```

- [ ] **Step 2.3: Create `packages/widgets/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test-setup.ts'],
  },
});
```

- [ ] **Step 2.4: Create `packages/widgets/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 2.5: Create `packages/widgets/src/index.ts` (empty barrel)**

```ts
// Public exports — populated as components are moved in.
export {};
```

- [ ] **Step 2.6: Install workspace deps**

Run from repo root: `npm install`

Expected: creates `packages/widgets/node_modules/` symlinks; root `node_modules/.bin/vitest` resolves.

- [ ] **Step 2.7: Verify the empty package builds and tests**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/packages/widgets
npx tsc --noEmit
npx vitest run
```

Expected: typecheck passes, vitest reports "No test files found." (Acceptable — package is empty.)

- [ ] **Step 2.8: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add packages/widgets package.json package-lock.json
git commit -m "packages/widgets: scaffold empty workspace package"
```

---

## Task 3: Define data interfaces and contexts in shared package

**Files:**
- Create: `packages/widgets/src/data/types.ts`
- Create: `packages/widgets/src/data/contexts.tsx`
- Create: `packages/widgets/src/data/index.ts`

- [ ] **Step 3.1: Create `packages/widgets/src/data/types.ts`**

```ts
export interface FrameRow {
  ts: string;          // ISO timestamp
  signal_id: number;
  value: number;       // = avg when bucketed, raw value otherwise
  vMin?: number;
  vMax?: number;
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

export interface SignalGroup {
  id: string;
  name: string;
  signalIds: number[];
}

export interface SignalCatalog {
  all(): SignalDefinition[];
  resolve(id: number | string): SignalDefinition | null;
  groups(): SignalGroup[];
}
```

- [ ] **Step 3.2: Create `packages/widgets/src/data/contexts.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { FramesStore, SignalCatalog } from './types.ts';

export const FramesContext = createContext<FramesStore | null>(null);
export const SignalsContext = createContext<SignalCatalog | null>(null);

export function useFrames(): FramesStore | null {
  return useContext(FramesContext);
}

export function useCatalog(): SignalCatalog {
  const cat = useContext(SignalsContext);
  if (!cat) throw new Error('useCatalog used outside SignalsProvider');
  return cat;
}

export function FramesProvider({
  store,
  children,
}: {
  store: FramesStore | null;
  children: ReactNode;
}) {
  return <FramesContext.Provider value={store}>{children}</FramesContext.Provider>;
}

export function SignalsProvider({
  catalog,
  children,
}: {
  catalog: SignalCatalog | null;
  children: ReactNode;
}) {
  if (!catalog) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"JetBrains Mono", monospace', fontSize: 11, letterSpacing: 2,
        color: '#6f7278',
      }}>
        LOADING SIGNALS…
      </div>
    );
  }
  return <SignalsContext.Provider value={catalog}>{children}</SignalsContext.Provider>;
}
```

- [ ] **Step 3.3: Create `packages/widgets/src/data/index.ts`**

```ts
export * from './types.ts';
export * from './contexts.tsx';
```

- [ ] **Step 3.4: Verify typecheck**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/packages/widgets
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add packages/widgets/src/data
git commit -m "packages/widgets: define FramesStore/SignalCatalog interfaces and contexts"
```

---

## Task 4: Move `colors.ts` into shared theme

**Files:**
- Create: `packages/widgets/src/theme/colors.ts`
- Create: `packages/widgets/src/theme/index.ts`
- Modify: `app/src/components/colors.ts` (replace with re-export)

- [ ] **Step 4.1: Copy `colors.ts` into the package**

Copy the contents of `/Users/andrewxue/Documents/daq-interface-26/app/src/components/colors.ts` verbatim into `packages/widgets/src/theme/colors.ts`. The existing file already has just the `COLORS` export — keep it as-is, no changes to symbol names.

- [ ] **Step 4.2: Create `packages/widgets/src/theme/index.ts`**

```ts
export * from './colors.ts';
```

- [ ] **Step 4.3: Replace `app/src/components/colors.ts` with a re-export**

Overwrite the file with:

```ts
export { COLORS } from '@nfr/widgets/theme';
```

- [ ] **Step 4.4: Add `@nfr/widgets` to `app/package.json`**

In `/Users/andrewxue/Documents/daq-interface-26/app/package.json`, add to the `"dependencies"` block:

```json
"@nfr/widgets": "*",
```

- [ ] **Step 4.5: Reinstall**

Run from repo root: `npm install`

Expected: `app/node_modules/@nfr/widgets` becomes a symlink to `packages/widgets`.

- [ ] **Step 4.6: Verify desktop typechecks and tests**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/app
npx tsc --noEmit
npm test
```

Expected: green.

- [ ] **Step 4.7: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add packages/widgets/src/theme app/src/components/colors.ts app/package.json package.json package-lock.json
git commit -m "packages/widgets: extract theme/colors; app re-exports from package"
```

---

## Task 5: Move widget renderers into shared package

This is a mechanical move: the entire `app/src/components/widgets.tsx` file (1295 lines) goes into the package. The desktop's `colors.ts` already re-exports from the package, so paths inside `widgets.tsx` need to change from `'./colors.ts'` to `'../theme/colors.ts'`.

**Files:**
- Create: `packages/widgets/src/widgets/index.ts`
- Create: `packages/widgets/src/widgets/widgets.tsx` (moved file)
- Modify: `app/src/components/widgets.tsx` (becomes re-export)
- Modify: `app/src/components/shell.tsx` (becomes re-export)

- [ ] **Step 5.1: Move `widgets.tsx`**

Move the file:

```bash
cd /Users/andrewxue/Documents/daq-interface-26
mv app/src/components/widgets.tsx packages/widgets/src/widgets/widgets.tsx
```

- [ ] **Step 5.2: Update internal imports inside the moved file**

In `packages/widgets/src/widgets/widgets.tsx`, change these import paths:

- `import type { Signal } from '../signals/catalog.ts';` → `import type { SignalDefinition as Signal } from '../data/types.ts';`
- `import { useCatalog } from './SignalsProvider.tsx';` → `import { useCatalog } from '../data/contexts.tsx';`
- `import { useFrames } from './FramesContext.tsx';` → `import { useFrames } from '../data/contexts.tsx';`
- `import { COLORS as W_COLORS } from './colors.ts';` → `import { COLORS as W_COLORS } from '../theme/colors.ts';`

If `useCatalog` is called like `catalog.resolve(sid)` and the original `SignalCatalog` type from `app/src/signals/catalog.ts` had a different shape, verify by reading the current file. If `resolve` already returns something matching `SignalDefinition`, no widget body changes needed; otherwise add a small adapter at call sites.

- [ ] **Step 5.3: Create the widgets barrel**

`packages/widgets/src/widgets/index.ts`:

```ts
export {
  GraphWidget,
  NumericWidget,
  GaugeWidget,
  BarWidget,
  HeatmapWidget,
  GgPlotWidget,
  WidgetShell,
  SignalChip,
  SignalPicker,
  GroupPill,
  Timeline,
  WidgetIcon,
  TopBar,
  NFRMark,
  WIDGET_TYPES,
} from './widgets.tsx';
```

- [ ] **Step 5.4: Update `packages/widgets/src/index.ts`**

```ts
export * from './data/index.ts';
export * from './theme/index.ts';
export * from './widgets/index.ts';
```

- [ ] **Step 5.5: Replace `app/src/components/widgets.tsx` with re-export**

Create the file with:

```ts
export {
  GraphWidget,
  NumericWidget,
  GaugeWidget,
  BarWidget,
  HeatmapWidget,
  GgPlotWidget,
  WidgetShell,
  SignalChip,
  SignalPicker,
  GroupPill,
  Timeline,
  WidgetIcon,
  TopBar,
  NFRMark,
  WIDGET_TYPES,
} from '@nfr/widgets';
```

- [ ] **Step 5.6: Replace `app/src/components/shell.tsx` with re-export**

```ts
export {
  SignalChip,
  SignalPicker,
  GroupPill,
  Timeline,
  WidgetShell,
  WidgetIcon,
  TopBar,
  NFRMark,
  WIDGET_TYPES,
} from '@nfr/widgets';
```

- [ ] **Step 5.7: Refactor `app/src/components/SignalsProvider.tsx` to use shared context**

Replace the file's body with:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { SignalsProvider as SharedSignalsProvider } from '@nfr/widgets';
import type { SignalCatalog } from '@nfr/widgets';
import { buildCatalog } from '../signals/catalog.ts';
import { apiGet } from '../api/client.ts';
import type { SignalDefinition } from '../api/types.ts';

export function SignalsProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<SignalCatalog | null>(null);

  useEffect(() => {
    apiGet<SignalDefinition[]>('/api/signal-definitions')
      .then((defs) => setCatalog(buildCatalog(defs) as unknown as SignalCatalog))
      .catch((err) => {
        console.error('Failed to load signal definitions', err);
        setCatalog(buildCatalog([]) as unknown as SignalCatalog);
      });
  }, []);

  return <SharedSignalsProvider catalog={catalog}>{children}</SharedSignalsProvider>;
}

export { useCatalog } from '@nfr/widgets';
```

The `unknown as` casts are intentional — `app/src/signals/catalog.ts` returns its own `SignalCatalog` shape; if the shapes differ, see Step 5.8.

- [ ] **Step 5.8: Reconcile `app/src/signals/catalog.ts` shape with shared interface**

Read `/Users/andrewxue/Documents/daq-interface-26/app/src/signals/catalog.ts`. If the returned object has methods `all()`, `resolve()`, and `groups()` matching the shared interface, drop the `unknown as` casts in step 5.7. If methods are named differently (e.g., `byId()` instead of `resolve()`), add a thin wrapper:

```ts
function toSharedCatalog(local: ReturnType<typeof buildCatalog>): SignalCatalog {
  return {
    all: () => local.all(),
    resolve: (id) => local.resolve(id),  // adjust method names as needed
    groups: () => local.groups(),
  };
}
```

Then use `setCatalog(toSharedCatalog(buildCatalog(defs)))`.

- [ ] **Step 5.9: Refactor `app/src/components/FramesContext.tsx`**

Replace the file with:

```tsx
export { FramesContext, useFrames } from '@nfr/widgets';
```

- [ ] **Step 5.10: Verify desktop builds and tests**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/app
npx tsc --noEmit
npm run build
npm test
```

Expected: green. If imports complain, search for any remaining `from './widgets.tsx'` or `from './colors.ts'` paths and update.

- [ ] **Step 5.11: Smoke test the desktop UI**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
cd desktop && npm run package:mac
open desktop/release/mac-arm64/nfrInterface.app
```

Click around the dock — widgets render, gear opens inspector, × removes, x-axis labels still match session duration. Quit the app.

- [ ] **Step 5.12: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add packages/widgets app/src/components/widgets.tsx app/src/components/shell.tsx app/src/components/SignalsProvider.tsx app/src/components/FramesContext.tsx
git commit -m "packages/widgets: move renderers + chrome; app re-exports from package"
```

---

## Task 6: Move `dir-dock.tsx` into shared package

`dir-dock.tsx` (the dock layout, drag-drop, inspector) imports `WidgetShell` from `./widgets.tsx` and `react-router-dom`'s `useNavigate`. The dock is shared, but the navigate target (`/import` etc.) is desktop-specific. Solution: accept navigation as a prop.

**Files:**
- Create: `packages/widgets/src/dock/dir-dock.tsx` (moved)
- Create: `packages/widgets/src/dock/compactVertical.ts` (extracted pure function)
- Create: `packages/widgets/src/dock/compactVertical.test.ts`
- Create: `packages/widgets/src/dock/index.ts`
- Modify: `app/src/App.tsx` or wherever `DockDirection` is used (pass nav callbacks)

- [ ] **Step 6.1: Inspect dir-dock for navigation usage**

Run: `grep -n 'useNavigate\|navigate(' /Users/andrewxue/Documents/daq-interface-26/app/src/components/dir-dock.tsx`

For each `navigate('/some/path')` call site, note the target. We'll accept these as callback props on `DockDirection`.

- [ ] **Step 6.2: Move dir-dock.tsx into the package**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
mv app/src/components/dir-dock.tsx packages/widgets/src/dock/dir-dock.tsx
```

- [ ] **Step 6.3: Update imports inside the moved file**

In `packages/widgets/src/dock/dir-dock.tsx`:

- Change `import { WidgetShell, ... } from './widgets.tsx';` → `from '../widgets/widgets.tsx';`
- Change `import { COLORS as SH_COLORS } from './colors.ts';` → `from '../theme/colors.ts';`
- Remove `import { useNavigate } from 'react-router-dom';` and any `const navigate = useNavigate();` — replace with a `navigate` prop on `DockDirectionProps`.
- Replace each `navigate('/some/path')` call with `props.navigate?.('/some/path')` (or the equivalent prop name).

Update `DockDirectionProps` to add:

```ts
navigate?: (path: string) => void;
```

- [ ] **Step 6.4: Extract `compactVertical` to its own file**

In `packages/widgets/src/dock/compactVertical.ts`:

```ts
export interface PlacedWidget {
  id: string;
  col: number;
  row: number;
  w: number;
  h: number;
  [key: string]: unknown;
}

export function compactVertical<T extends PlacedWidget>(ws: T[]): T[] {
  const sorted = [...ws].sort((a, b) => (a.row - b.row) || (a.col - b.col));
  const placed: T[] = [];
  for (const w of sorted) {
    let newRow = 1;
    for (const p of placed) {
      const colsOverlap = !(p.col + p.w <= w.col || w.col + w.w <= p.col);
      if (colsOverlap) newRow = Math.max(newRow, p.row + p.h);
    }
    placed.push({ ...w, row: newRow });
  }
  return placed;
}
```

Then in `dir-dock.tsx`, replace the inline `compactVertical` definition with `import { compactVertical } from './compactVertical.ts';`.

- [ ] **Step 6.5: Write a test for `compactVertical` (failing first)**

`packages/widgets/src/dock/compactVertical.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compactVertical } from './compactVertical.ts';

describe('compactVertical', () => {
  it('pulls widgets up into empty rows', () => {
    const input = [
      { id: 'a', col: 1, row: 1, w: 6, h: 2 },
      { id: 'b', col: 1, row: 5, w: 6, h: 2 },  // gap of 2 rows
    ];
    const out = compactVertical(input);
    expect(out.find((w) => w.id === 'b')!.row).toBe(3);
  });

  it('respects horizontal positions when compacting', () => {
    const input = [
      { id: 'a', col: 1, row: 1, w: 4, h: 2 },
      { id: 'b', col: 5, row: 1, w: 4, h: 2 },
      { id: 'c', col: 1, row: 5, w: 4, h: 2 },  // below a only
    ];
    const out = compactVertical(input);
    expect(out.find((w) => w.id === 'c')!.row).toBe(3);
    // b stays at row 1 — c didn't push it
    expect(out.find((w) => w.id === 'b')!.row).toBe(1);
  });

  it('preserves widget metadata', () => {
    const input = [{ id: 'a', col: 1, row: 5, w: 6, h: 2, type: 'graph' as const }];
    const out = compactVertical(input);
    expect(out[0].type).toBe('graph');
    expect(out[0].row).toBe(1);
  });
});
```

- [ ] **Step 6.6: Run the test — should pass**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/packages/widgets
npx vitest run src/dock/compactVertical.test.ts
```

Expected: 3 passed.

- [ ] **Step 6.7: Create `packages/widgets/src/dock/index.ts`**

```ts
export { DockDirection } from './dir-dock.tsx';
export { compactVertical } from './compactVertical.ts';
```

- [ ] **Step 6.8: Update package barrel**

In `packages/widgets/src/index.ts`, add:

```ts
export * from './dock/index.ts';
```

- [ ] **Step 6.9: Update `app/` callers of `DockDirection`**

Find usage: `grep -rn 'DockDirection' /Users/andrewxue/Documents/daq-interface-26/app/src`

At each call site, pass the `navigate` prop:

```tsx
import { useNavigate } from 'react-router-dom';
import { DockDirection } from '@nfr/widgets';

function DesktopDockPage() {
  const navigate = useNavigate();
  return <DockDirection /* ...existing props... */ navigate={navigate} />;
}
```

- [ ] **Step 6.10: Verify desktop builds and tests**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/app
npx tsc --noEmit
npm test
npm run build
```

Expected: green.

- [ ] **Step 6.11: Smoke test the desktop**

Repackage and run as in Step 5.11. Verify dock layout, drag-drop, and any nav buttons (e.g., import/setup links) still work.

- [ ] **Step 6.12: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add packages/widgets app/src
git commit -m "packages/widgets: extract dock layout (DockDirection + compactVertical)"
```

---

## Task 7: Wire desktop's `useLiveFrames` to satisfy shared `FramesStore` interface

The desktop's `FramesStore` class in `app/src/hooks/useLiveFrames.ts` already has `series()`, `latest()`, `firstTs()`, `latestTs()`, `subscribe()`, `getVersion()`. It just needs to be typed against the shared interface.

**Files:**
- Modify: `app/src/hooks/useLiveFrames.ts`
- Modify: `app/src/main.tsx` or wherever `FramesContext.Provider` is set up

- [ ] **Step 7.1: Type `FramesStore` against the shared interface**

In `/Users/andrewxue/Documents/daq-interface-26/app/src/hooks/useLiveFrames.ts`:

- Add at top: `import type { FramesStore as IFramesStore, FrameRow as IFrameRow } from '@nfr/widgets';`
- Change `export class FramesStore` → `export class FramesStore implements IFramesStore`
- Ensure local `FrameRow` matches: rename to `LiveFrameRow` if it has extra fields, or just declare `export type FrameRow = IFrameRow;` and remove the duplicate interface declaration if shapes match.

Run typecheck:

```bash
cd /Users/andrewxue/Documents/daq-interface-26/app
npx tsc --noEmit
```

Expected: passes. If TypeScript complains about a missing interface method, add it (likely just a type-only fix).

- [ ] **Step 7.2: Wrap the desktop in `FramesProvider`**

Find where the existing `FramesContext.Provider` (or `FramesCtx.Provider`) is set up — likely `app/src/main.tsx` or `App.tsx`. Run:

```bash
grep -rn 'FramesContext.Provider\|FramesCtx.Provider' /Users/andrewxue/Documents/daq-interface-26/app/src
```

Replace each `<FramesContext.Provider value={store}>...` with `<FramesProvider store={store}>...` imported from `@nfr/widgets`. Same for any direct `<FramesCtx.Provider>` usage now that the shared one is the source of truth.

- [ ] **Step 7.3: Verify and smoke test**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/app
npx tsc --noEmit
npm run build
npm test
```

Then repackage and open the .app. Verify the dock shows live data (the LIVE indicator pulses, numeric widgets update).

- [ ] **Step 7.4: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add app/src
git commit -m "app: useLiveFrames implements shared FramesStore interface"
```

---

## Task 8: Add Supabase RPC `get_signals_window`

This task uses Supabase MCP tools. The RPC needs `time_bucket`; check whether `timescaledb` is installed first, and fall back to `date_trunc` if not.

**Files:**
- Create: `desktop/migrations/0003_get_signals_window.sql`

- [ ] **Step 8.1: Check whether `timescaledb` extension is installed**

Use the Supabase MCP tool:

```
mcp__supabase__list_extensions
```

Look for `timescaledb` in the result with `installed: true`. Note the answer — it determines which version of the RPC body you write.

- [ ] **Step 8.2: Check what's already in the public schema**

```
mcp__supabase__execute_sql
  query: "SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name;"
```

Confirm `get_signals_window` and `list_sessions` don't already exist.

- [ ] **Step 8.3: Create migration file `desktop/migrations/0003_get_signals_window.sql`**

If `timescaledb` is installed, write:

```sql
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
```

If `timescaledb` is NOT installed, replace the `time_bucket(...)` line with:

```sql
to_timestamp(floor(extract(epoch FROM r.ts) / p_bucket_secs) * p_bucket_secs) AT TIME ZONE 'UTC' AS ts,
```

(Aligns each row's timestamp to a bucket-floor in seconds since epoch.)

- [ ] **Step 8.4: Apply the migration to Supabase**

```
mcp__supabase__apply_migration
  name: "get_signals_window"
  query: <full contents of 0003_get_signals_window.sql>
```

Expected: succeeds. If it errors on a column type (e.g., `signal_id` is `INTEGER` not `SMALLINT`), fix the parameter type in the migration to match and re-apply.

- [ ] **Step 8.5: Smoke test the RPC**

Pick a known session UUID:

```
mcp__supabase__execute_sql
  query: "SELECT id, started_at, ended_at FROM sessions ORDER BY started_at DESC LIMIT 1;"
```

Then call the RPC:

```
mcp__supabase__execute_sql
  query: "SELECT * FROM get_signals_window(
    '<that uuid>'::uuid,
    (SELECT array_agg(id) FROM signal_definitions LIMIT 5)::smallint[],
    '<that started_at>'::timestamptz,
    '<that ended_at>'::timestamptz,
    10
  ) LIMIT 20;"
```

Expected: returns rows with non-null `value_min`/`value_max`/`value_avg`/`sample_n`. If `value_min == value_max == value_avg` for every row, the bucket size is too small (each bucket has 1 sample) — increase `p_bucket_secs`.

- [ ] **Step 8.6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add desktop/migrations/0003_get_signals_window.sql
git commit -m "supabase: add get_signals_window RPC (multi-signal bucketed window with min/max/avg)"
```

---

## Task 9: Add Supabase RPC `list_sessions`

**Files:**
- Create: `desktop/migrations/0004_list_sessions.sql`

- [ ] **Step 9.1: Create migration file**

```sql
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

- [ ] **Step 9.2: Apply the migration**

```
mcp__supabase__apply_migration
  name: "list_sessions"
  query: <full contents>
```

- [ ] **Step 9.3: Smoke test**

```
mcp__supabase__execute_sql
  query: "SELECT * FROM list_sessions(5);"
```

Expected: 0–5 rows of sessions. Note: `signal_count` may be 0 for empty sessions and that's fine.

- [ ] **Step 9.4: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add desktop/migrations/0004_list_sessions.sql
git commit -m "supabase: add list_sessions RPC (session list with duration + signal count)"
```

---

## Task 10: Add `bucketFor` helper to website

**Files:**
- Create: `frontend/interface/src/adapters/bucketFor.ts`
- Create: `frontend/interface/src/adapters/bucketFor.test.ts`
- Modify: `frontend/interface/package.json` (add vitest if missing)

- [ ] **Step 10.1: Check whether vitest is in frontend deps**

```bash
grep -E '"vitest"' /Users/andrewxue/Documents/daq-interface-26/frontend/interface/package.json
```

If not present, add to `devDependencies`:

```json
"vitest": "^2.1.8"
```

And add a script to `"scripts"`: `"test": "vitest run"`.

Then `npm install` from repo root.

- [ ] **Step 10.2: Write the failing test**

`frontend/interface/src/adapters/bucketFor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bucketFor } from './bucketFor.ts';

describe('bucketFor', () => {
  it('targets ~800 buckets across the range', () => {
    expect(bucketFor(3600, 800)).toBe(5);   // 1 hour → 4.5s rounded to 5
    expect(bucketFor(60, 800)).toBe(1);     // 1 min → can't go below 1s
    expect(bucketFor(300, 800)).toBe(1);    // 5 min → 0.375s rounded up to 1
    expect(bucketFor(7200, 800)).toBe(9);   // 2 hours → 9s
  });

  it('never returns less than 1', () => {
    expect(bucketFor(10, 800)).toBe(1);
    expect(bucketFor(0, 800)).toBe(1);
  });
});
```

- [ ] **Step 10.3: Run the test — should fail**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npx vitest run src/adapters/bucketFor.test.ts
```

Expected: fails ("Cannot find module").

- [ ] **Step 10.4: Implement `bucketFor`**

`frontend/interface/src/adapters/bucketFor.ts`:

```ts
/**
 * Pick a bucket size (seconds) that produces ~targetBuckets buckets across
 * the given duration. Floored at 1 second since sd_readings has sub-second
 * resolution but the RPC accepts INT seconds.
 */
export function bucketFor(durationSecs: number, targetBuckets: number): number {
  if (durationSecs <= 0) return 1;
  return Math.max(1, Math.round(durationSecs / targetBuckets));
}
```

- [ ] **Step 10.5: Run the test — should pass**

```bash
npx vitest run src/adapters/bucketFor.test.ts
```

Expected: 2 passed.

- [ ] **Step 10.6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add frontend/interface/src/adapters frontend/interface/package.json package.json package-lock.json
git commit -m "frontend: add bucketFor helper with tests"
```

---

## Task 11: Build `SupabaseFramesStore` (the FramesStore impl for Supabase)

**Files:**
- Create: `frontend/interface/src/adapters/SupabaseFramesStore.ts`
- Create: `frontend/interface/src/adapters/SupabaseFramesStore.test.ts`

- [ ] **Step 11.1: Write the failing test**

`frontend/interface/src/adapters/SupabaseFramesStore.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SupabaseFramesStore } from './SupabaseFramesStore.ts';

describe('SupabaseFramesStore', () => {
  it('partitions ingested rows by signal_id', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:00Z', signal_id: 1, value_avg: 10, value_min: 5,  value_max: 15, sample_n: 100 },
      { ts: '2026-05-01T00:00:01Z', signal_id: 1, value_avg: 12, value_min: 6,  value_max: 18, sample_n: 100 },
      { ts: '2026-05-01T00:00:00Z', signal_id: 2, value_avg: 50, value_min: 49, value_max: 51, sample_n: 100 },
    ]);

    expect(s.series(1)).toHaveLength(2);
    expect(s.series(2)).toHaveLength(1);
    expect(s.series(99)).toEqual([]);
  });

  it('exposes vMin/vMax on each FrameRow', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:00Z', signal_id: 1, value_avg: 10, value_min: 5, value_max: 15, sample_n: 100 },
    ]);
    const [row] = s.series(1);
    expect(row.value).toBe(10);
    expect(row.vMin).toBe(5);
    expect(row.vMax).toBe(15);
  });

  it('tracks first/latest ts across all signals', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:05Z', signal_id: 1, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 },
      { ts: '2026-05-01T00:00:01Z', signal_id: 2, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 },
    ]);
    expect(s.firstTs()).toBe('2026-05-01T00:00:01Z');
    expect(s.latestTs()).toBe('2026-05-01T00:00:05Z');
  });

  it('notifies subscribers on ingest', () => {
    const s = new SupabaseFramesStore();
    const cb = vi.fn();
    const unsub = s.subscribe(cb);
    s.ingest([{ ts: '2026-05-01T00:00:00Z', signal_id: 1, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 }]);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    s.ingest([{ ts: '2026-05-01T00:00:01Z', signal_id: 1, value_avg: 2, value_min: 2, value_max: 2, sample_n: 1 }]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('series() returns rows in ts-ascending order even if ingested out of order', () => {
    const s = new SupabaseFramesStore();
    s.ingest([
      { ts: '2026-05-01T00:00:02Z', signal_id: 1, value_avg: 2, value_min: 2, value_max: 2, sample_n: 1 },
      { ts: '2026-05-01T00:00:01Z', signal_id: 1, value_avg: 1, value_min: 1, value_max: 1, sample_n: 1 },
    ]);
    const ts = s.series(1).map((r) => r.ts);
    expect(ts).toEqual(['2026-05-01T00:00:01Z', '2026-05-01T00:00:02Z']);
  });
});
```

- [ ] **Step 11.2: Run the test — should fail**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npx vitest run src/adapters/SupabaseFramesStore.test.ts
```

Expected: fails ("Cannot find module").

- [ ] **Step 11.3: Implement `SupabaseFramesStore`**

`frontend/interface/src/adapters/SupabaseFramesStore.ts`:

```ts
import type { FrameRow, FramesStore } from '@nfr/widgets';

export interface RpcRow {
  ts: string;
  signal_id: number;
  value_avg: number;
  value_min: number;
  value_max: number;
  sample_n: number;
  signal_name?: string;
  unit?: string;
}

export class SupabaseFramesStore implements FramesStore {
  private bySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  ingest(rows: RpcRow[]): void {
    for (const r of rows) {
      const frame: FrameRow = {
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value_avg,
        vMin: r.value_min,
        vMax: r.value_max,
      };

      let buf = this.bySignal.get(r.signal_id);
      if (!buf) {
        buf = [];
        this.bySignal.set(r.signal_id, buf);
      }
      buf.push(frame);

      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < frame.ts) this.latestBySignal.set(r.signal_id, frame);

      if (this._firstTs === null || frame.ts < this._firstTs) this._firstTs = frame.ts;
      if (this._latestTs === null || frame.ts > this._latestTs) this._latestTs = frame.ts;
    }
    // Sort each affected buffer once after the batch.
    for (const r of rows) {
      const buf = this.bySignal.get(r.signal_id);
      if (buf) buf.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  series(signalId: number): FrameRow[] {
    return this.bySignal.get(signalId) ?? [];
  }

  latest(signalId: number): FrameRow | null {
    return this.latestBySignal.get(signalId) ?? null;
  }

  firstTs(): string | null { return this._firstTs; }
  latestTs(): string | null { return this._latestTs; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getVersion(): number { return this.version; }

  reset(): void {
    this.bySignal.clear();
    this.latestBySignal.clear();
    this._firstTs = null;
    this._latestTs = null;
    this.version++;
    for (const l of this.listeners) l();
  }
}
```

- [ ] **Step 11.4: Run the tests — should pass**

```bash
npx vitest run src/adapters/SupabaseFramesStore.test.ts
```

Expected: 5 passed.

- [ ] **Step 11.5: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add frontend/interface/src/adapters/SupabaseFramesStore.ts frontend/interface/src/adapters/SupabaseFramesStore.test.ts
git commit -m "frontend: add SupabaseFramesStore implementing shared FramesStore interface"
```

---

## Task 12: Add `useSupabaseCatalog`, `useSessionList`, `useSupabaseFrames` hooks

**Files:**
- Create: `frontend/interface/src/adapters/useSupabaseCatalog.ts`
- Create: `frontend/interface/src/adapters/useSessionList.ts`
- Create: `frontend/interface/src/adapters/useSupabaseFrames.ts`

- [ ] **Step 12.1: Implement `useSupabaseCatalog`**

`frontend/interface/src/adapters/useSupabaseCatalog.ts`:

```ts
import { useEffect, useState } from 'react';
import type { SignalCatalog, SignalDefinition } from '@nfr/widgets';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows } from '@/lib/paginatedFetch';

export function useSupabaseCatalog(): SignalCatalog | null {
  const [catalog, setCatalog] = useState<SignalCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllRows((sb: any) =>
      sb.from('signal_definitions').select('id, source, signal_name, unit, description').order('id'),
    )
      .then((rows: SignalDefinition[]) => {
        if (cancelled) return;
        const byId = new Map(rows.map((r) => [r.id, r]));
        const byName = new Map(rows.map((r) => [r.signal_name, r]));
        setCatalog({
          all: () => rows,
          resolve: (id) => {
            if (typeof id === 'number') return byId.get(id) ?? null;
            return byName.get(id) ?? byId.get(Number(id)) ?? null;
          },
          groups: () => [],  // groups not yet modeled in Supabase; empty for now
        });
      })
      .catch((err: unknown) => {
        console.error('useSupabaseCatalog: fetch failed', err);
        setCatalog({
          all: () => [],
          resolve: () => null,
          groups: () => [],
        });
      });
    return () => { cancelled = true; };
  }, []);

  return catalog;
}
```

- [ ] **Step 12.2: Implement `useSessionList`**

`frontend/interface/src/adapters/useSessionList.ts`:

```ts
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface SessionListItem {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number;
  driver: string | null;
  car: string | null;
  signal_count: number;
}

export function useSessionList(limit = 50): {
  sessions: SessionListItem[];
  loading: boolean;
  error: Error | null;
} {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.rpc('list_sessions', { p_limit: limit })
      .then(({ data, error: rpcErr }) => {
        if (cancelled) return;
        if (rpcErr) { setError(new Error(rpcErr.message)); return; }
        setSessions((data ?? []) as SessionListItem[]);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [limit]);

  return { sessions, loading, error };
}
```

- [ ] **Step 12.3: Implement `useSupabaseFrames`**

`frontend/interface/src/adapters/useSupabaseFrames.ts`:

```ts
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { SupabaseFramesStore, type RpcRow } from './SupabaseFramesStore.ts';
import { bucketFor } from './bucketFor.ts';

export interface UseSupabaseFramesArgs {
  sessionId: string | null;
  signalIds: number[];
  start: string | null;   // ISO
  end: string | null;     // ISO
  targetBuckets?: number;
}

export function useSupabaseFrames(args: UseSupabaseFramesArgs) {
  const storeRef = useRef<SupabaseFramesStore>(new SupabaseFramesStore());
  const store = storeRef.current;

  // Resubscribe so widgets re-render on ingest.
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );

  // Stringify the dependency for stable effect identity.
  const idsKey = useMemo(() => [...args.signalIds].sort((a, b) => a - b).join(','), [args.signalIds]);

  useEffect(() => {
    if (!args.sessionId || !args.start || !args.end || args.signalIds.length === 0) return;
    let cancelled = false;

    const startMs = Date.parse(args.start);
    const endMs = Date.parse(args.end);
    const durationSecs = Math.max(1, Math.round((endMs - startMs) / 1000));
    const bucketSecs = bucketFor(durationSecs, args.targetBuckets ?? 800);

    store.reset();
    supabase.rpc('get_signals_window', {
      p_session_id: args.sessionId,
      p_signal_ids: args.signalIds,
      p_start: args.start,
      p_end: args.end,
      p_bucket_secs: bucketSecs,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error('get_signals_window failed', error); return; }
      store.ingest((data ?? []) as RpcRow[]);
    });

    return () => { cancelled = true; };
  }, [args.sessionId, idsKey, args.start, args.end, args.targetBuckets, store]);

  return store;
}
```

- [ ] **Step 12.4: Verify typecheck**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
# If frontend has tsc available; otherwise rely on the build step.
npx tsc --noEmit --jsx react-jsx --module esnext --moduleResolution bundler --target es2022 --lib es2022,dom,dom.iterable src/adapters/*.ts 2>&1 | head -40
```

If frontend has no tsconfig set up for adapter `.ts` files, ensure `tsconfig.json` `include` covers `src/**/*` (the existing one likely does — check).

- [ ] **Step 12.5: Build to confirm Vite picks up the new files**

```bash
npm run build 2>&1 | tail -20
```

Expected: builds.

- [ ] **Step 12.6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add frontend/interface/src/adapters
git commit -m "frontend: add Supabase adapter hooks (catalog, session list, frames)"
```

---

## Task 13: One-widget smoke route at `/app-dev`

This proves end-to-end fetch → render before building the full dock.

**Files:**
- Create: `frontend/interface/src/routes/AppDevRoute.jsx`
- Modify: `frontend/interface/src/App.jsx`

- [ ] **Step 13.1: Add `@nfr/widgets` to frontend deps**

In `/Users/andrewxue/Documents/daq-interface-26/frontend/interface/package.json` `"dependencies"`, add:

```json
"@nfr/widgets": "*",
```

Then from repo root: `npm install`.

Verify the symlink: `ls -l /Users/andrewxue/Documents/daq-interface-26/frontend/interface/node_modules/@nfr/widgets` should show a link to `../../packages/widgets`.

- [ ] **Step 13.2: Create the smoke route**

`frontend/interface/src/routes/AppDevRoute.jsx`:

```jsx
import { useState } from 'react';
import {
  GraphWidget,
  FramesProvider,
  SignalsProvider,
} from '@nfr/widgets';
import { useSupabaseCatalog } from '@/adapters/useSupabaseCatalog';
import { useSessionList } from '@/adapters/useSessionList';
import { useSupabaseFrames } from '@/adapters/useSupabaseFrames';

export default function AppDevRoute() {
  const catalog = useSupabaseCatalog();
  const { sessions, loading: sessionsLoading } = useSessionList(20);
  const [sessionId, setSessionId] = useState(null);

  // Pick the first session by default once they load.
  const active = sessionId ?? sessions[0]?.id ?? null;
  const session = sessions.find((s) => s.id === active);

  // Just one signal for the smoke test — first signal in the catalog.
  const allDefs = catalog?.all() ?? [];
  const signalIds = allDefs.length > 0 ? [allDefs[0].id] : [];

  const store = useSupabaseFrames({
    sessionId: active,
    signalIds,
    start: session?.started_at ?? null,
    end: session?.ended_at ?? null,
  });

  return (
    <SignalsProvider catalog={catalog}>
      <FramesProvider store={store}>
        <div style={{
          padding: 16, fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
          background: '#1e1f22', color: '#dfe1e5', minHeight: '100vh',
        }}>
          <h1 style={{ fontSize: 14, letterSpacing: 1.5, marginBottom: 12 }}>
            APP-DEV — single-widget smoke test
          </h1>

          <div style={{ marginBottom: 12 }}>
            <label>SESSION:&nbsp;</label>
            <select
              value={active ?? ''}
              onChange={(e) => setSessionId(e.target.value)}
              disabled={sessionsLoading}
              style={{ background: '#2b2d30', color: '#dfe1e5', padding: 4 }}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} · {s.duration_secs}s · {s.signal_count} signals
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8, color: '#9da0a8' }}>
            Signal: {allDefs[0]?.signal_name ?? '(none)'} ({allDefs[0]?.unit ?? ''})
          </div>

          <div style={{ height: 320, border: '1px solid rgba(255,255,255,0.09)' }}>
            {signalIds.length > 0 && active && session?.ended_at ? (
              <GraphWidget signals={signalIds} t={1} mode="replay" />
            ) : (
              <div style={{ padding: 16 }}>Waiting for catalog + session…</div>
            )}
          </div>
        </div>
      </FramesProvider>
    </SignalsProvider>
  );
}
```

- [ ] **Step 13.3: Wire the route**

In `/Users/andrewxue/Documents/daq-interface-26/frontend/interface/src/App.jsx`, add:

```jsx
import AppDevRoute from './routes/AppDevRoute';
```

Inside the `<Routes>` block, add:

```jsx
<Route path="/app-dev" element={<AppDevRoute />} />
```

- [ ] **Step 13.4: Run the dev server and load the route**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npm run dev
```

Open http://localhost:5173/app-dev in a browser.

Expected:
- Catalog loads (signal name shows in the "Signal:" label).
- Session dropdown populates (from `list_sessions`).
- Picking a session triggers an `rpc('get_signals_window', ...)` call (visible in browser DevTools Network tab) and the graph fills in.
- X-axis shows `mm:ss` matching the session duration.

If the graph stays empty, check the Network tab for the RPC response body. Common issues:
- RLS forbids anon read on `sd_readings` — fix RLS policy with `mcp__supabase__execute_sql` to allow anon select.
- `signal_id` type mismatch (`SMALLINT` vs `INTEGER`) — adjust the RPC's parameter type.

- [ ] **Step 13.5: Stop the dev server**

`Ctrl+C` in the terminal where `npm run dev` is running.

- [ ] **Step 13.6: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add frontend/interface/src/routes/AppDevRoute.jsx frontend/interface/src/App.jsx frontend/interface/package.json package.json package-lock.json
git commit -m "frontend: add /app-dev smoke route — single GraphWidget against Supabase"
```

---

## Task 14: Build the full `/app` dock route

**Files:**
- Create: `frontend/interface/src/routes/AppRoute.jsx`
- Modify: `frontend/interface/src/App.jsx`

- [ ] **Step 14.1: Create the full dock route**

`frontend/interface/src/routes/AppRoute.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DockDirection,
  TopBar,
  FramesProvider,
  SignalsProvider,
} from '@nfr/widgets';
import { useSupabaseCatalog } from '@/adapters/useSupabaseCatalog';
import { useSessionList } from '@/adapters/useSessionList';
import { useSupabaseFrames } from '@/adapters/useSupabaseFrames';

const DOCK_STORAGE_KEY = 'daqWidgetLayout';

function readDockSignalIds() {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return [];
    const widgets = JSON.parse(raw);
    const ids = new Set();
    for (const w of widgets) {
      for (const sig of w.signals ?? []) {
        const n = typeof sig === 'number' ? sig : Number(sig);
        if (!Number.isNaN(n)) ids.add(n);
      }
    }
    return [...ids];
  } catch { return []; }
}

export default function AppRoute() {
  const [search, setSearch] = useSearchParams();
  const sessionId = search.get('session');

  const catalog = useSupabaseCatalog();
  const { sessions } = useSessionList(50);
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0] ?? null;

  // Default to first session if URL has none.
  useEffect(() => {
    if (!sessionId && session?.id) {
      setSearch((p) => { p.set('session', session.id); return p; }, { replace: true });
    }
  }, [sessionId, session?.id, setSearch]);

  // Read dock layout from localStorage to know which signals to fetch.
  const [signalIds, setSignalIds] = useState(readDockSignalIds);
  useEffect(() => {
    const onStorage = () => setSignalIds(readDockSignalIds());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // Re-read every time the dock writes (DockDirection writes to the same key).
  useEffect(() => {
    const interval = setInterval(() => {
      const next = readDockSignalIds();
      const same = next.length === signalIds.length && next.every((v, i) => v === signalIds[i]);
      if (!same) setSignalIds(next);
    }, 500);
    return () => clearInterval(interval);
  }, [signalIds]);

  const store = useSupabaseFrames({
    sessionId: session?.id ?? null,
    signalIds,
    start: session?.started_at ?? null,
    end: session?.ended_at ?? null,
  });

  const sessionLabel = session
    ? `${session.date} · ${session.driver ?? '—'}`
    : 'Loading…';

  return (
    <SignalsProvider catalog={catalog}>
      <FramesProvider store={store}>
        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          background: '#1e1f22', color: '#dfe1e5',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          <TopBar
            mode="replay"
            onMode={() => { /* live mode out of scope for v1 */ }}
            session={sessionLabel}
            date={session?.date ?? ''}
            sessionSlot={
              <select
                value={session?.id ?? ''}
                onChange={(e) => setSearch((p) => { p.set('session', e.target.value); return p; })}
                style={{
                  background: '#2b2d30', color: '#dfe1e5',
                  border: '1px solid rgba(255,255,255,0.09)', padding: '3px 8px',
                  fontFamily: 'inherit', fontSize: 10,
                }}
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.date} · {s.duration_secs}s · {s.signal_count} signals
                  </option>
                ))}
              </select>
            }
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            <DockDirection
              t={1}
              mode="replay"
              onMode={() => {}}
              onT={() => {}}
              durationSecs={session?.duration_secs ?? 0}
              density="comfortable"
              graphStyle="line"
              frames={store}
            />
          </div>
        </div>
      </FramesProvider>
    </SignalsProvider>
  );
}
```

Note: the `DockDirection` props above match what `app/src/components/dir-dock.tsx` exposed in the desktop. Verify the prop names by reading the component's `DockDirectionProps` interface (now in `packages/widgets/src/dock/dir-dock.tsx`) and adjust if the names differ.

- [ ] **Step 14.1.5: Add a status badge so Supabase errors are visible**

The spec calls for surfacing fetch state. Extend `useSupabaseFrames` to expose loading/error state (in addition to the store), then render a small badge in the TopBar.

In `frontend/interface/src/adapters/useSupabaseFrames.ts`, change the return to include status. Add at the top:

```ts
export type FetchStatus = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };
```

Track status with a ref-backed external store or a parallel `useState`. The simplest:

```ts
import { useState } from 'react';
// ...
const [status, setStatus] = useState<FetchStatus>({ kind: 'idle' });
// inside the effect:
setStatus({ kind: 'loading' });
supabase.rpc(...).then(({ data, error }) => {
  if (cancelled) return;
  if (error) { setStatus({ kind: 'error', message: error.message }); return; }
  store.ingest((data ?? []) as RpcRow[]);
  setStatus({ kind: 'ready' });
});
```

Return `{ store, status }` instead of just `store`, and update Step 13.2 (smoke route) and Step 14.1 callers to destructure.

In `AppRoute.jsx`, render a badge in the TopBar's `right` slot:

```jsx
<TopBar
  /* ...existing props... */
  right={
    <span style={{
      padding: '2px 8px', fontSize: 9, letterSpacing: 1,
      border: '1px solid var(--c-border, rgba(255,255,255,0.09))',
      color: status.kind === 'error' ? '#e06c6c' : status.kind === 'ready' ? '#7ec98f' : '#9da0a8',
    }}>
      {status.kind === 'error' ? `ERR: ${status.message.slice(0, 40)}` : status.kind.toUpperCase()}
    </span>
  }
/>
```

- [ ] **Step 14.2: Wire the route**

In `frontend/interface/src/App.jsx`:

```jsx
import AppRoute from './routes/AppRoute';
```

Inside `<Routes>`:

```jsx
<Route path="/app" element={<AppRoute />} />
```

- [ ] **Step 14.3: Run dev server and exercise the dock**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npm run dev
```

Open http://localhost:5173/app. Verify:
- Session picker in top right shows sessions and switches.
- Sidebar lists signals.
- Dragging a signal onto the grid creates a widget.
- Adding a graph triggers a fresh `get_signals_window` call (Network tab — payload includes the new signal_id).
- Removing a widget compacts the layout vertically.
- X-axis labels match the chosen session's duration.

- [ ] **Step 14.4: Stop dev server.**

- [ ] **Step 14.5: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add frontend/interface/src/routes/AppRoute.jsx frontend/interface/src/App.jsx
git commit -m "frontend: add /app dock route backed by Supabase adapters"
```

---

## Task 15: Reskin Home and AppDownload

The visual goal: dark `#1e1f22` background, `#dfe1e5` text, `#a78bfa` purple accent, JetBrains Mono font, square corners. Keep all existing copy and component structure — only theme tokens change.

**Files:**
- Modify: `frontend/interface/src/pages/Home.jsx`
- Modify: `frontend/interface/src/pages/Home.css`
- Modify: `frontend/interface/src/pages/AppDownload.jsx`
- Modify: `frontend/interface/src/pages/AppDownload.css`
- Modify: `frontend/interface/src/components/TopBar.jsx` (so the marketing pages share the new chrome)

- [ ] **Step 15.1: Define a shared theme stylesheet**

Create `frontend/interface/src/pages/theme.css`:

```css
:root {
  --c-bg: #1e1f22;
  --c-bg-panel: #2b2d30;
  --c-bg-elev: #3c3f41;
  --c-text: #dfe1e5;
  --c-text-mute: #9da0a8;
  --c-text-faint: #6f7278;
  --c-border: rgba(255,255,255,0.09);
  --c-accent: #7c6fde;
  --c-accent-bright: #a78bfa;
  --c-ok: #7ec98f;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

body, .marketing {
  background: var(--c-bg);
  color: var(--c-text);
  font-family: var(--font-mono);
}
```

- [ ] **Step 15.2: Import the theme in `main.jsx`**

In `/Users/andrewxue/Documents/daq-interface-26/frontend/interface/src/main.jsx`, add at top:

```jsx
import './pages/theme.css';
```

- [ ] **Step 15.3: Restyle `Home.css`**

Replace heavy gradients/colors with theme variables. Wrap the page root in `className="marketing"`. Replace any hardcoded hex colors with `var(--c-*)` tokens.

(Exact CSS rewrites depend on what's in the existing file; the goal is: dark background, mono font, square corners, purple links, no rounded buttons. Keep layout/grid identical.)

- [ ] **Step 15.4: Restyle `AppDownload.css`**

Same treatment.

- [ ] **Step 15.5: Update `TopBar.jsx` to use the theme**

If the marketing TopBar still uses framer-motion gradients, swap the inline styles to theme tokens. Keep the structure and the navigation links.

- [ ] **Step 15.6: Smoke test in browser**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npm run dev
```

Visit `/`, `/download`, and `/app`. All three should share the same color/font palette. Stop the dev server.

- [ ] **Step 15.7: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add frontend/interface/src/pages frontend/interface/src/components/TopBar.jsx frontend/interface/src/main.jsx
git commit -m "frontend: reskin marketing pages to match desktop palette"
```

---

## Task 16: Cutover — redirect old routes, delete old pages

Once `/app` is verified working in production, retire the old pages.

**Files:**
- Modify: `frontend/interface/vercel.json` (add redirects)
- Delete: `frontend/interface/src/pages/Dash.jsx`, `Dash.css`
- Delete: `frontend/interface/src/pages/Graphs.jsx`, `Graphs.css`
- Delete: `frontend/interface/src/pages/Replay.jsx`, `Replay.css`
- Modify: `frontend/interface/src/App.jsx` (remove old routes)
- Modify: `frontend/interface/package.json` (drop unused deps)

- [ ] **Step 16.1: Add redirects to `vercel.json`**

Inspect the current file: `cat /Users/andrewxue/Documents/daq-interface-26/frontend/interface/vercel.json`.

Add (or merge into existing structure):

```json
{
  "redirects": [
    { "source": "/dash",   "destination": "/app", "permanent": true },
    { "source": "/graphs", "destination": "/app", "permanent": true },
    { "source": "/replay", "destination": "/app", "permanent": true }
  ]
}
```

- [ ] **Step 16.2: Remove old route entries from `App.jsx`**

Delete the `<Route path="/dash" ...>`, `<Route path="/graphs" ...>`, `<Route path="/replay" ...>` lines from `frontend/interface/src/App.jsx` and the corresponding imports.

- [ ] **Step 16.3: Delete the old page files**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface/src/pages
rm Dash.jsx Dash.css Graphs.jsx Graphs.css Replay.jsx Replay.css
```

- [ ] **Step 16.4: Find and delete now-orphaned components**

```bash
grep -rn 'from "@/widgets/BaseDash"\|from "@/widgets/Sidebar"\|from "@/widgets/MiniGraph"' /Users/andrewxue/Documents/daq-interface-26/frontend/interface/src 2>&1
```

For each component imported only by a deleted page, delete the component file. Common candidates: `widgets/BaseDash.jsx`, `widgets/Sidebar.jsx`, `widgets/MiniGraph.jsx`, `widgets/ConfigurableGauge.jsx`, `widgets/Readout.jsx`, `widgets/StatusLight.jsx`, `widgets/bars/*`, `widgets/gauges/*`. Run the grep first; only delete if nothing else imports them.

- [ ] **Step 16.5: Drop unused dependencies**

Audit `frontend/interface/package.json` for libs only used by the deleted pages:

- `react-grid-layout` — likely safe to remove (the new dock uses CSS-grid from `@nfr/widgets`).
- `react-resizable` — same.
- `recharts` — if no surviving file uses it, drop it.
- `react-gauge-component` — likely orphaned.

For each, run e.g.:

```bash
grep -rn 'react-grid-layout' /Users/andrewxue/Documents/daq-interface-26/frontend/interface/src
```

If no hits, remove the entry from `package.json`. After all removals: `npm install` from repo root.

- [ ] **Step 16.6: Build the website to confirm nothing's broken**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npm run build
```

Expected: green. If a `Cannot find module` error mentions a deleted file, search and remove the lingering import.

- [ ] **Step 16.7: Smoke test**

```bash
npm run dev
```

Visit `/`, `/download`, `/app`, then `/dash`, `/graphs`, `/replay`. The last three should hit your dev server's catch-all (Vite dev server doesn't honor `vercel.json` redirects — that's expected). After deployment to Vercel, those three URLs will 301 to `/app`.

Stop the dev server.

- [ ] **Step 16.8: Commit**

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add -A
git commit -m "frontend: cutover — delete Dash/Graphs/Replay, 301 to /app, drop unused deps"
```

---

## Task 17: Final integration test against production Supabase branch

**Files:** none.

- [ ] **Step 17.1: Create a Supabase dev branch**

```
mcp__supabase__create_branch
  name: "web-redesign-smoke"
```

This gives an isolated DB matching production. The MCP returns a branch ID and a connection URL.

- [ ] **Step 17.2: Point the website at the branch (temporarily)**

In `/Users/andrewxue/Documents/daq-interface-26/frontend/interface/.env.local`, replace `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the branch's values.

- [ ] **Step 17.3: Run the full smoke**

```bash
cd /Users/andrewxue/Documents/daq-interface-26/frontend/interface
npm run dev
```

Open http://localhost:5173/app. Click through:

- Session picker shows recent sessions
- Adding a graph widget loads data within ~1 second
- Removing widgets compacts the layout
- Gear icon opens the inspector
- Settings × closes the inspector
- X-axis labels match session duration in mm:ss
- A signal known to have transients (e.g., brake pressure) shows the min/max envelope as a faint band below/around the line

If anything fails, fix and recommit before proceeding.

- [ ] **Step 17.4: Restore production env**

Revert `.env.local` to the production URL/key.

- [ ] **Step 17.5: Delete the Supabase dev branch**

```
mcp__supabase__delete_branch
  branch_id: <the id from Step 17.1>
```

- [ ] **Step 17.6: Final commit (if any docs/CHANGELOG updates)**

If you update `README.md` or any docs to reflect the new `/app` route:

```bash
cd /Users/andrewxue/Documents/daq-interface-26
git add README.md
git commit -m "docs: note new /app route for the website"
```

Otherwise, no commit — the smoke test was verification, not code.

---

## Done

At this point:
- The repo is an npm-workspace monorepo.
- `packages/widgets/` owns the renderers, dock layout, chrome, and data interfaces.
- The desktop and the website both consume `@nfr/widgets`, with their own data adapters.
- The website's `/app` route uses `get_signals_window` (one round-trip, server-joined, min/max/avg per bucket) and `list_sessions` to render the dock.
- Old website pages (`/dash`, `/graphs`, `/replay`) 301 to `/app`.
- Live mode on web is intentionally absent — the abstraction is in place to add it later by writing a Realtime-backed `FramesStore`.
