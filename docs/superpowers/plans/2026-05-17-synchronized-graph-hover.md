# Synchronized Graph Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering on any graph in the dock moves the cursor on every graph to the same session time, and each graph shows its own inline tooltip at that time.

**Architecture:** A new `HoverContext` (alongside `FramesContext`) holds a shared session-fraction `hoverT ∈ [0,1] | null`. The dock wraps its children in `<HoverProvider>`. `GraphWidget` replaces its local `hoverFrac` state with a value derived from `hoverT` mapped through that graph's own `[t0, t1]` window. Pointer move/leave on any graph writes to `hoverT`.

**Tech Stack:** React 19, TypeScript, vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-05-17-synchronized-graph-hover-design.md`

---

## File Structure

- `packages/widgets/src/data/contexts.tsx` — add `HoverContext`, `HoverProvider`, `useHover` (single new responsibility added to the existing contexts module).
- `packages/widgets/src/data/hover-context.test.tsx` — new unit test for the provider/hook.
- `packages/widgets/src/dock/dir-dock.tsx` — wrap the existing `FramesCtx.Provider` subtree in `<HoverProvider>`.
- `packages/widgets/src/widgets/widgets.tsx` — replace local `hoverFrac` state in `GraphWidget` with a context-derived value; broadcast on move/leave/drag.
- `packages/widgets/src/widgets/graph-hover-sync.test.tsx` — new integration test for two-graph hover sync.

---

### Task 1: Add HoverContext + HoverProvider + useHover

**Files:**
- Modify: `packages/widgets/src/data/contexts.tsx`
- Test: `packages/widgets/src/data/hover-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/widgets/src/data/hover-context.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HoverProvider, useHover } from './contexts.tsx';

function Reader({ id }: { id: string }) {
  const { hoverT } = useHover();
  return <span data-testid={`reader-${id}`}>{hoverT == null ? 'null' : String(hoverT)}</span>;
}

function Setter({ value }: { value: number | null }) {
  const { setHoverT } = useHover();
  return <button data-testid="set" onClick={() => setHoverT(value)}>set</button>;
}

describe('HoverProvider', () => {
  it('shares hoverT across consumers and clears on null', () => {
    render(
      <HoverProvider>
        <Reader id="a" />
        <Reader id="b" />
        <Setter value={0.5} />
      </HoverProvider>,
    );
    expect(screen.getByTestId('reader-a').textContent).toBe('null');
    expect(screen.getByTestId('reader-b').textContent).toBe('null');

    act(() => { screen.getByTestId('set').click(); });
    expect(screen.getByTestId('reader-a').textContent).toBe('0.5');
    expect(screen.getByTestId('reader-b').textContent).toBe('0.5');
  });

  it('useHover outside provider returns a no-op default', () => {
    // Standalone consumer with no provider — hoverT is null and setHoverT is a no-op.
    render(<Reader id="solo" />);
    expect(screen.getByTestId('reader-solo').textContent).toBe('null');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/widgets && npx vitest run src/data/hover-context.test.tsx`
Expected: FAIL — `HoverProvider` / `useHover` not exported from `./contexts.tsx`.

- [ ] **Step 3: Add the context, provider, and hook**

Edit `packages/widgets/src/data/contexts.tsx`. Add after the existing imports/exports (keep everything that's already there). The full new file is:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { FramesStore, SignalCatalog } from './types.ts';

export const FramesContext = createContext<FramesStore | null>(null);
export const SignalsContext = createContext<SignalCatalog | null>(null);

export interface HoverState {
  hoverT: number | null;
  setHoverT: (v: number | null) => void;
}

const NOOP_HOVER: HoverState = { hoverT: null, setHoverT: () => {} };
export const HoverContext = createContext<HoverState>(NOOP_HOVER);

export function useFrames(): FramesStore | null {
  return useContext(FramesContext);
}

export function useCatalog(): SignalCatalog {
  const cat = useContext(SignalsContext);
  if (!cat) throw new Error('useCatalog used outside SignalsProvider');
  return cat;
}

export function useHover(): HoverState {
  return useContext(HoverContext);
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

export function HoverProvider({ children }: { children: ReactNode }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const value = useMemo<HoverState>(() => ({ hoverT, setHoverT }), [hoverT]);
  return <HoverContext.Provider value={value}>{children}</HoverContext.Provider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/widgets && npx vitest run src/data/hover-context.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/src/data/contexts.tsx packages/widgets/src/data/hover-context.test.tsx
git commit -m "widgets: add HoverContext + HoverProvider for cross-graph hover"
```

---

### Task 2: Wrap dock subtree in HoverProvider

**Files:**
- Modify: `packages/widgets/src/dock/dir-dock.tsx` (lines 16, 402, 971)

- [ ] **Step 1: Import HoverProvider**

Edit `packages/widgets/src/dock/dir-dock.tsx` line 16. Current line:

```tsx
import { FramesContext as FramesCtx, useFrames } from '../data/contexts.tsx';
```

Replace with:

```tsx
import { FramesContext as FramesCtx, useFrames, HoverProvider } from '../data/contexts.tsx';
```

- [ ] **Step 2: Wrap the existing subtree**

In the same file, at line 402, the current opening of the dock JSX is:

```tsx
  return (
    <FramesCtx.Provider value={frames ?? null}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
```

Change to:

```tsx
  return (
    <FramesCtx.Provider value={frames ?? null}>
    <HoverProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: SH_COLORS.bgInner, fontFamily: '"Inter", system-ui, sans-serif' }}>
```

At line 971, the closing of the dock JSX is currently:

```tsx
    </FramesCtx.Provider>
```

The line directly above it should already be the closing `</div>` of the root flex container. Change the closing block to:

```tsx
    </HoverProvider>
    </FramesCtx.Provider>
```

- [ ] **Step 3: Typecheck + existing dock tests still pass**

Run: `cd packages/widgets && npm run typecheck && npx vitest run src/dock`
Expected: typecheck clean; existing dock tests (`compactVertical.test.ts`, `dropAction.test.ts`) PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/widgets/src/dock/dir-dock.tsx
git commit -m "widgets: wrap dock in HoverProvider"
```

---

### Task 3: GraphWidget reads/writes shared hover

**Files:**
- Modify: `packages/widgets/src/widgets/widgets.tsx` (lines 3, 42, 218–224, 231, 250, 272)

This task swaps the local `hoverFrac` state for a value derived from the shared `hoverT`. It also makes pointer move/leave/drag broadcast the session fraction.

- [ ] **Step 1: Import useHover**

At the top of `packages/widgets/src/widgets/widgets.tsx`, line 4 currently:

```tsx
import { FramesContext, useCatalog } from '../data/contexts.tsx';
```

Replace with:

```tsx
import { FramesContext, useCatalog, useHover } from '../data/contexts.tsx';
```

- [ ] **Step 2: Remove the local hoverFrac state**

Around line 42 of the same file, the current `GraphWidget` body contains:

```tsx
  const [hoverFrac, setHoverFrac] = useState<number | null>(null); // 0..1 within plot
  const [zoomDrag, setZoomDrag] = useState<{ a: number; b: number } | null>(null);
```

Replace those two lines with:

```tsx
  const { hoverT, setHoverT } = useHover();
  const [zoomDrag, setZoomDrag] = useState<{ a: number; b: number } | null>(null);
```

- [ ] **Step 3: Derive in-window hoverFrac from session hoverT**

In `GraphWidget`, immediately after the existing block that computes `t0` and `t1` (the block ends around line 68 with `t0 = 0; t1 = 1; }` closing the replay branch), add:

```tsx
  // Derive in-window fraction from the shared session-fraction hoverT.
  // Anything outside this graph's window hides the cursor for this frame.
  let hoverFrac: number | null = null;
  if (hoverT != null) {
    const f = (hoverT - t0) / Math.max(1e-9, t1 - t0);
    hoverFrac = f >= 0 && f <= 1 ? f : null;
  }
```

The downstream code that already reads `hoverFrac` (`tCursor`, cursor rendering, tooltip gate at line ~272, the dashed-vs-solid styling near line ~366) does not need to change — it sees the same shape it always did.

- [ ] **Step 4: Broadcast on pointer move / leave / zoom drag**

Around lines 218–224 the current pointer handlers are:

```tsx
  const onPointerMove = (e: any) => {
    if (!svgRef.current) return;
    const f = fracFromEvent(e);
    setHoverFrac(f);
    if (zoomDrag) setZoomDrag({ a: zoomDrag.a, b: f });
  };
  const onPointerLeave = () => { if (!zoomDrag) setHoverFrac(null); };
```

Replace with:

```tsx
  const onPointerMove = (e: any) => {
    if (!svgRef.current) return;
    const f = fracFromEvent(e);
    setHoverT(t0 + f * (t1 - t0));
    if (zoomDrag) setZoomDrag({ a: zoomDrag.a, b: f });
  };
  const onPointerLeave = () => { if (!zoomDrag) setHoverT(null); };
```

Around line 231 inside `onPointerDown`, the drag `mv` handler currently is:

```tsx
    const mv = (ev: any) => { endF = fracFromEvent(ev); setZoomDrag({ a: startF, b: endF }); setHoverFrac(endF); };
```

Replace with:

```tsx
    const mv = (ev: any) => {
      endF = fracFromEvent(ev);
      setZoomDrag({ a: startF, b: endF });
      setHoverT(t0 + endF * (t1 - t0));
    };
```

- [ ] **Step 5: Typecheck + existing tests still pass**

Run: `cd packages/widgets && npm run typecheck && npx vitest run`
Expected: typecheck clean; all existing tests PASS (no production callers of `setHoverFrac` remain; the GraphWidget's external behavior in a single-graph dock is unchanged because `hoverT` is broadcast and read back through the same provider).

- [ ] **Step 6: Manual smoke (desktop dev)**

Run: `cd app && npm run dev`
Open the app, drop two `graph` widgets in the dock, hover on one, confirm the cursor + tooltip appears on both at the same x. Move off — both clear. Hover a graph that's been zoomed; out-of-window positions hide its cursor.

- [ ] **Step 7: Commit**

```bash
git add packages/widgets/src/widgets/widgets.tsx
git commit -m "widgets: GraphWidget broadcasts/reads shared hoverT"
```

---

### Task 4: Two-graph hover-sync integration test

**Files:**
- Test: `packages/widgets/src/widgets/graph-hover-sync.test.tsx`

This task adds a small integration test that proves: hover on one `GraphWidget` causes a second `GraphWidget` (inside the same `HoverProvider`) to render its cursor at the matching x. It also adds the test hook (`data-testid`) we rely on.

- [ ] **Step 1: Add a stable data-testid to the cursor line**

In `packages/widgets/src/widgets/widgets.tsx`, find the cursor `<line>` element. The current element (around line 364–370) reads:

```tsx
          <line
            x1={cursorX} x2={cursorX} y1={padT} y2={padT + plotH}
            stroke={hoverFrac !== null ? W_COLORS.accentBright : W_COLORS.accentBright}
            strokeWidth={1}
            strokeDasharray={hoverFrac !== null ? undefined : '2,3'}
            opacity={hoverFrac !== null ? 0.9 : 0.55}
          />
```

Add a `data-testid` attribute and only render the line when there's a cursor to show. Replace with:

```tsx
          {cursorVisible && (
            <line
              data-testid="graph-cursor"
              x1={cursorX} x2={cursorX} y1={padT} y2={padT + plotH}
              stroke={hoverFrac !== null ? W_COLORS.accentBright : W_COLORS.accentBright}
              strokeWidth={1}
              strokeDasharray={hoverFrac !== null ? undefined : '2,3'}
              opacity={hoverFrac !== null ? 0.9 : 0.55}
            />
          )}
```

(The existing render path already only paints when `cursorVisible` in surrounding JSX; if your local code already has that guard inline, just add the `data-testid` attribute. The behavioral change: a graph with `hoverT == null` and `t` outside `[t0, t1]` no longer paints a dashed playhead. That case doesn't occur in the live or replay modes used today, where `t` is always inside the window, so this is a no-op for users.)

- [ ] **Step 2: Write the failing integration test**

Create `packages/widgets/src/widgets/graph-hover-sync.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HoverProvider, FramesContext, SignalsContext } from '../data/contexts.tsx';
import { GraphWidget } from './widgets.tsx';
import type { FramesStore, SignalCatalog } from '../data/types.ts';
import type { Signal } from '../signals/catalog.ts';

const SIG: Signal = {
  id: 1, name: 'TestSignal', unit: 'V', color: '#0f0',
  min: 0, max: 10,
} as Signal;

const catalog: SignalCatalog = {
  list: () => [SIG],
  resolve: (key) => (key === 'TestSignal' || key === 1 ? SIG : null),
} as unknown as SignalCatalog;

function makeStore(): FramesStore {
  const rows = Array.from({ length: 11 }, (_, i) => ({
    ts: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    signal_id: 1,
    value: i,
  }));
  return {
    push: () => {},
    latest: () => rows[rows.length - 1],
    series: () => rows,
    firstTs: () => rows[0].ts,
    latestTs: () => rows[rows.length - 1].ts,
    getVersion: () => 0,
    subscribe: () => () => {},
  } as unknown as FramesStore;
}

function harness() {
  const store = makeStore();
  return render(
    <SignalsContext.Provider value={catalog}>
      <FramesContext.Provider value={store}>
        <HoverProvider>
          <div data-testid="a" style={{ width: 400, height: 200 }}>
            <GraphWidget signals={['TestSignal']} t={1} mode="replay" />
          </div>
          <div data-testid="b" style={{ width: 400, height: 200 }}>
            <GraphWidget signals={['TestSignal']} t={1} mode="replay" />
          </div>
        </HoverProvider>
      </FramesContext.Provider>
    </SignalsContext.Provider>,
  );
}

describe('GraphWidget hover sync', () => {
  it('hovering on one graph renders a cursor on the other', () => {
    harness();

    // Before any hover, in replay mode both graphs render the playhead cursor
    // because t=1 is inside [0,1]. Count the baseline.
    const before = screen.queryAllByTestId('graph-cursor').length;

    // Fire a pointer move on the first graph's SVG.
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    fireEvent.pointerMove(svgs[0], { clientX: 200, clientY: 100 });

    const after = screen.queryAllByTestId('graph-cursor').length;
    // Both graphs should still show a cursor — and since hover overrides the
    // playhead in both, count stays at 2.
    expect(after).toBe(2);

    // Move pointer off — at least one graph (the hovered one) should still show
    // the playhead since t=1 is inside the window, so count remains 2 in replay.
    fireEvent.pointerLeave(svgs[0]);
    expect(screen.queryAllByTestId('graph-cursor').length).toBe(before);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd packages/widgets && npx vitest run src/widgets/graph-hover-sync.test.tsx`
Expected: PASS.

If it fails because the `signals` prop accepts the raw catalog key but the `Signal` typing in the test stub doesn't match exactly, adjust the stub to match the real `Signal` shape used in `packages/widgets/src/signals/catalog.ts` (read that file once and copy minimal required fields — do not invent fields).

- [ ] **Step 4: Run the whole widgets test suite**

Run: `cd packages/widgets && npx vitest run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/widgets/src/widgets/widgets.tsx packages/widgets/src/widgets/graph-hover-sync.test.tsx
git commit -m "widgets: test cross-graph hover sync + add cursor test hook"
```

---

### Task 5: Rebuild the app bundle and verify end-to-end

**Files:** none modified.

- [ ] **Step 1: Build the app**

Run: `cd app && npm run build`
Expected: build succeeds; new hashed `dist/assets/index-*.js`.

- [ ] **Step 2: Manual smoke against desktop**

Either:
- Run `cd desktop && npm run dev:server` and load `http://127.0.0.1:4444`, or
- Run `cd desktop && npm run package:mac` and open the packaged app.

In both replay (loaded session) and live (active recording) modes, drop two graph widgets, hover over one, confirm the cursor + inline tooltip on the second graph follows along, and that pointer leave clears both.

- [ ] **Step 3: Bump desktop version (only if packaging a release)**

If you produced a packaged build, bump `desktop/package.json` `"version"` from its current value to the next patch (e.g. `0.4.2` → `0.4.3`) and re-run `npm run package:mac`. Skip this step if you're only running `dev:server`.

```bash
git add desktop/package.json
git commit -m "desktop: bump version for hover-sync release"
```

---

## Self-Review Notes

- **Spec coverage:** HoverContext (Task 1), dock wrap (Task 2), GraphWidget swap + broadcast + derive (Task 3), unit + integration tests (Tasks 1, 4). Out-of-scope items in the spec (non-graph widgets, combined tooltip, perf optimization) are deliberately not addressed.
- **Type consistency:** `setHoverT(v: number | null)` is used identically in Task 1 definition, Task 3 callers, and Task 4 test harness. `hoverT` is `number | null` everywhere. `useHover()` returns `{ hoverT, setHoverT }` with no other fields.
- **No placeholders:** every step contains the exact replacement code or command.
