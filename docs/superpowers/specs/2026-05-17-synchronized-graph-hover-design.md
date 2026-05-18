# Synchronized Graph Hover — Design

## Problem

Hovering over a graph in the dock shows a cursor line and a small tooltip on that one graph only. When several graphs are visible at once, the user wants to read every signal at the same instant — currently they have to mentally line up the x position across graphs, or move the scrubber.

## Goal

While the mouse is over any graph, every graph in the dock renders its cursor at the same point in session time, and each shows its own inline tooltip at that time. Releasing the hover (pointer leave) returns every graph to its base state.

## Approach

Lift the existing local `hoverFrac` state out of `GraphWidget` and into a shared React context that lives next to `FramesContext`. The broadcast coordinate is a **session fraction `hoverT ∈ [0, 1]`** — the same coordinate the scrubber uses — so graphs with different windows (zoom, future per-graph window settings) can each map it through their own `t0/t1`.

## Components

### `HoverContext` and `HoverProvider`
Location: `packages/widgets/src/data/contexts.tsx` (alongside `FramesContext`).

Value:
```ts
interface HoverState {
  hoverT: number | null;          // session fraction 0..1, or null when not hovering
  setHoverT(v: number | null): void;
}
```

`HoverProvider` owns the state with `useState<number | null>(null)` and supplies a stable `setHoverT`. Exported hook: `useHover()`.

### Dock wiring
`packages/widgets/src/dock/dir-dock.tsx` wraps its children in `<HoverProvider>`. Nothing else changes in the dock.

### `GraphWidget`
File: `packages/widgets/src/widgets/widgets.tsx`.

- Remove the local `useState` for `hoverFrac`.
- Read `{ hoverT, setHoverT }` from `useHover()`.
- Derive `hoverFrac` each render:
  ```ts
  let hoverFrac: number | null = null;
  if (hoverT != null) {
    const f = (hoverT - t0) / (t1 - t0);
    hoverFrac = f >= 0 && f <= 1 ? f : null;
  }
  ```
  The rest of the file (`tCursor`, cursor line, tooltip, value lookup) keeps using `hoverFrac` and is unchanged.
- `onPointerMove`: compute the in-window fraction `f` as today, then `setHoverT(t0 + f * (t1 - t0))`.
- `onPointerLeave`: `setHoverT(null)` (still guarded by the zoom-drag condition exactly as today).
- Zoom-drag mid-drag broadcasts the current session fraction the same way `onPointerMove` does — preserves today's behavior where the cursor tracks during the drag.

## Coordinate notes

- **Replay mode**: every graph spans `[0, 1]` of session, so `hoverFrac == hoverT`.
- **Live mode**: graphs share `t` and `win`, so windows align; `hoverT` falls inside every visible graph.
- **Zoomed graph**: window is `[zoom[0], zoom[1]]`; `hoverT` outside that range yields `hoverFrac = null` and the graph hides its cursor for that frame. No special-case code.

## Out of scope

- Non-graph widgets (gauge / numeric / bar / heatmap) do not react to `hoverT`. They keep showing the scrub-cursor / live value as today. Easy to extend later by having them prefer `hoverT` over `t` when non-null.
- Combined cross-graph tooltip ("one popup, all signals"). Each graph keeps its own inline tooltip; together they cover all signals.
- Perf optimization (rAF throttle, selector context). Context fans out to every graph on every pointer move; defer optimization until it's actually a problem.

## Testing

`packages/widgets/src/data/hover-context.test.tsx`
- Two consumer components inside one `HoverProvider`: one calls `setHoverT(0.5)`, the other reads `0.5`. Setting `null` clears.

`packages/widgets/src/widgets/graph-hover-sync.test.tsx`
- Render two `GraphWidget`s inside `<HoverProvider><FramesContext.Provider value={stub}>…`. Fire `pointermove` on graph A; assert graph B's cursor element is in the DOM. Fire `pointerleave` on A; assert graph B's cursor is gone.
- Render two graphs where B has `zoom={[0, 0.5]}`. Drive `setHoverT(0.8)` (via a test harness consumer). Assert graph B does not render a cursor.

Existing GraphWidget tests must continue to pass — in the single-graph case the derived `hoverFrac` matches the previous local-state behavior exactly.

## Files changed

- `packages/widgets/src/data/contexts.tsx` — add `HoverContext`, `HoverProvider`, `useHover`.
- `packages/widgets/src/dock/dir-dock.tsx` — wrap children in `<HoverProvider>`.
- `packages/widgets/src/widgets/widgets.tsx` — replace local `hoverFrac` state with context-derived value; broadcast on move/leave.
- `packages/widgets/src/data/hover-context.test.tsx` — new.
- `packages/widgets/src/widgets/graph-hover-sync.test.tsx` — new.
