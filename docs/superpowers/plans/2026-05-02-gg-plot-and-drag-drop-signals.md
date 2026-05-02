# G-G plot fix and drag-drop signal UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the empty G-G scatter widget; add an ALL/ACTIVE filter to the signal sidebar; enable drag-drop placement of signals into the widget grid via a type-picker popup.

**Architecture:** All changes live in two files: `app/src/components/widgets.tsx` (the GgPlotWidget body, the SignalPicker filter prop, draggable rows) and `app/src/components/dir-dock.tsx` (filter toggle, drop handler on the grid, type popup). Drop-routing logic is extracted to a small pure helper so it can be unit-tested without rendering React.

**Tech Stack:** React 19, TypeScript, Vitest, native HTML5 drag-and-drop API, localStorage for filter persistence.

---

## File map

- **Modify** `app/src/components/widgets.tsx`
  - Rewrite `GgPlotWidget` body (Task 1)
  - Add `activeOnly?: boolean` prop to `SignalPicker`; filter signals when true (Task 2)
  - Add `draggable` + `onDragStart` to signal rows (Task 3)
- **Modify** `app/src/components/dir-dock.tsx`
  - Add ALL/ACTIVE toggle component above the picker (Task 2)
  - Persist toggle state via `localStorage` (Task 2)
  - Add `<DropTypePopup>` modal component (Task 4)
  - Add `onDragOver` + `onDrop` to the grid container; route via `decideDropAction` (Task 5)
- **Create** `app/src/components/dropAction.ts`
  - Pure function `decideDropAction(widget | null, signalId)` returning a typed action (Task 4)
- **Create** `app/src/components/dropAction.test.ts` — unit tests for the routing helper (Task 4)

---

## Task 1: Rewrite GgPlotWidget body

**Files:**
- Modify: `app/src/components/widgets.tsx` — replace the body of `GgPlotWidget` (currently around lines 418–545)

The new widget plots `X_Axis_Acceleration_Uncompensated / 9.81` on the X axis and `Y_Axis_Acceleration_Uncompensated / 9.81` on the Y axis. No sign flips. Auto-fit range to data with a floor of ±2 g. SVG renders at percent dimensions using a measured container so it works before `ResizeObserver` fires. Reference rings at 0.5g, 1g (highlighted), 1.5g, 2g.

- [ ] **Step 1: Replace the GgPlotWidget body**

Find the existing function `export function GgPlotWidget(...)` in `widgets.tsx` and replace its body with this implementation. Keep the `interface GgPlotWidgetProps` declaration above it as-is.

```tsx
export function GgPlotWidget({
  t: _t,
  mode = 'replay',
  compact = false,
  window: win = 0.05,
  zoom = null,
}: GgPlotWidgetProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 240 });

  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrap.current);
    // Seed from initial size in case ResizeObserver doesn't fire immediately.
    const r = wrap.current.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const xSig = catalog.byName('X_Axis_Acceleration_Uncompensated');
  const ySig = catalog.byName('Y_Axis_Acceleration_Uncompensated');
  const GRAVITY = 9.80665;
  const MIN_HALF = 2; // floor on the half-range so rings stay visible

  // Data extraction
  const xs = (xSig && frames?.series(xSig.id)) ?? [];
  const ys = (ySig && frames?.series(ySig.id)) ?? [];
  const len = Math.min(xs.length, ys.length);

  // Apply zoom / live windowing
  let start = 0;
  let end = len;
  if (zoom) {
    start = Math.max(0, Math.floor(zoom[0] * len));
    end = Math.max(start + 1, Math.min(len, Math.ceil(zoom[1] * len)));
  } else if (mode === 'live') {
    const winLen = Math.max(8, Math.floor(len * win));
    start = Math.max(0, len - winLen);
  }

  // Convert to g and find data extent for auto-fit
  const xg: number[] = new Array(end - start);
  const yg: number[] = new Array(end - start);
  let maxAbs = 0;
  for (let i = start; i < end; i++) {
    const x = xs[i].value / GRAVITY;
    const y = ys[i].value / GRAVITY;
    xg[i - start] = x;
    yg[i - start] = y;
    const m = Math.max(Math.abs(x), Math.abs(y));
    if (m > maxAbs) maxAbs = m;
  }
  const half = Math.max(MIN_HALF, Math.ceil(maxAbs * 1.1));

  // Geometry. Square plot centered in the container.
  const pad = compact ? 22 : 30;
  const plot = Math.max(40, Math.min(size.w, size.h) - pad * 2);
  const cx = size.w / 2;
  const cy = size.h / 2;
  const halfPx = plot / 2;
  const scale = halfPx / half;

  // Ring radii in g
  const rings = [0.5, 1, 1.5, 2].filter((g) => g <= half);

  return (
    <div
      ref={wrap}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {rings.map((g) => (
          <circle
            key={g}
            cx={cx}
            cy={cy}
            r={g * scale}
            fill="none"
            stroke={g === 1 ? W_COLORS.gridMid : W_COLORS.grid}
            strokeWidth={g === 1 ? 1 : 0.5}
            strokeDasharray={g === 1 ? '' : '2 3'}
          />
        ))}
        <line x1={cx - halfPx} y1={cy} x2={cx + halfPx} y2={cy} stroke={W_COLORS.gridMid} strokeWidth={0.5} />
        <line x1={cx} y1={cy - halfPx} x2={cx} y2={cy + halfPx} stroke={W_COLORS.gridMid} strokeWidth={0.5} />
        <rect
          x={cx - halfPx}
          y={cy - halfPx}
          width={plot}
          height={plot}
          fill="none"
          stroke={W_COLORS.border}
          strokeWidth={0.5}
        />
        {xg.map((x, i) => {
          const recent = i >= xg.length - 30;
          // Plot Y goes downward in SVG, so subtract.
          return (
            <circle
              key={i}
              cx={cx + x * scale}
              cy={cy - yg[i] * scale}
              r={recent ? 1.6 : 1}
              fill={recent ? W_COLORS.accent : W_COLORS.text}
              opacity={recent ? 0.95 : 0.25}
            />
          );
        })}
        <text x={cx + halfPx - 2} y={cy - 4} textAnchor="end" fontSize={9} fill={W_COLORS.textMute} fontFamily="monospace">
          X (g)
        </text>
        <text x={cx + 4} y={cy - halfPx + 10} fontSize={9} fill={W_COLORS.textMute} fontFamily="monospace">
          Y (g)
        </text>
        <text x={cx + 1 * scale + 2} y={cy + 9} fontSize={8} fill={W_COLORS.textFaint} fontFamily="monospace">
          1g
        </text>
        {(!xSig || !ySig) && (
          <text x={cx} y={cy - halfPx - 4} textAnchor="middle" fontSize={9} fill={W_COLORS.textFaint} fontFamily="monospace">
            IMU acceleration signals not in catalog
          </text>
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the dev server and visually verify**

Run: `cd app && npm run dev` and open the dashboard with a session that contains IMU readings. Add a g-g widget. Expected: scatter of points with reference rings; "X (g)" / "Y (g)" labels; range auto-fits.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/widgets.tsx
git commit -m "fix g-g plot: simple X/Y with auto-fit and resilient sizing"
```

---

## Task 2: ALL/ACTIVE signal filter

**Files:**
- Modify: `app/src/components/widgets.tsx` — `SignalPicker` accepts an `activeOnly` prop and filters by `frames.series(sig.id).length > 0` when true
- Modify: `app/src/components/dir-dock.tsx` — render an ALL/ACTIVE toggle above the `SignalPicker` and pass the state down; persist via `localStorage`

- [ ] **Step 1: Add `activeOnly` prop to SignalPicker**

In `widgets.tsx`, edit the `SignalPickerProps` interface to add `activeOnly?: boolean`, and edit `SignalPicker(...)` to accept it. Wire the filter into the existing `matches` computation. The frames store comes from `useFrames()` — already imported in this file.

```tsx
interface SignalPickerProps {
  onPick?: (id: any) => void;
  selected?: any[];
  multi?: boolean;
  compact?: boolean;
  filter?: string;
  height?: number | string;
  onFilterChange?: (s: string) => void;
  activeOnly?: boolean;
}
export function SignalPicker({ onPick, selected = [], compact = false, filter = '', height = '100%', onFilterChange, activeOnly = false }: SignalPickerProps) {
  const catalog = useCatalog();
  const frames = useFrames();
  const [localFilter, setLocalFilter] = useState(filter);
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const q = (onFilterChange ? filter : localFilter).toLowerCase();

  const matches = catalog.ALL.filter((s) => {
    if (groupFilter !== 'all' && s.group !== groupFilter) return false;
    if (activeOnly && (frames?.latest(s.id) ?? null) === null) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.groupName.toLowerCase().includes(q);
  });
```

The rest of the function body is unchanged. This is just adding `activeOnly` to the props destructure and adding one line in the filter.

- [ ] **Step 2: Add the toggle to dir-dock**

In `dir-dock.tsx`, the `<SignalPicker>` is rendered around line 384. Above it (or next to it within the same panel), add a two-position segmented control bound to a state variable. Persist to localStorage.

Find the existing import block at the top and ensure `useEffect` is imported. Then add this state near the other `useState` declarations in the component (around line 83):

```tsx
const FILTER_KEY = 'nfr_signal_filter';
const [signalFilter, setSignalFilter] = useState<'all' | 'active'>(() => {
  if (typeof window === 'undefined') return 'all';
  const v = window.localStorage.getItem(FILTER_KEY);
  return v === 'active' ? 'active' : 'all';
});
useEffect(() => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FILTER_KEY, signalFilter);
}, [signalFilter]);
```

Then render the toggle right before the `<SignalPicker>` invocation. Replace the existing `<SignalPicker selected={selectedSignal} onPick={...} />` block with one that includes the toggle above it:

```tsx
<div style={{ display: 'flex', gap: 0, padding: '6px 10px 0 10px', background: SH_COLORS.bg }}>
  <button
    onClick={() => setSignalFilter('all')}
    style={{
      flex: 1,
      padding: '4px 8px',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 9,
      letterSpacing: 1.5,
      cursor: 'pointer',
      background: signalFilter === 'all' ? SH_COLORS.bgElev : 'transparent',
      color: signalFilter === 'all' ? SH_COLORS.text : SH_COLORS.textMute,
      border: `1px solid ${SH_COLORS.border}`,
      borderRight: 'none',
    }}
  >
    ALL
  </button>
  <button
    onClick={() => setSignalFilter('active')}
    style={{
      flex: 1,
      padding: '4px 8px',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 9,
      letterSpacing: 1.5,
      cursor: 'pointer',
      background: signalFilter === 'active' ? SH_COLORS.bgElev : 'transparent',
      color: signalFilter === 'active' ? SH_COLORS.text : SH_COLORS.textMute,
      border: `1px solid ${SH_COLORS.border}`,
    }}
  >
    ACTIVE
  </button>
</div>
<SignalPicker
  selected={selectedSignal ? [selectedSignal] : []}
  onPick={(s) => setSelectedSignal(s === selectedSignal ? null : s)}
  activeOnly={signalFilter === 'active'}
/>
```

(Adjust the existing `selected={selectedSignal}` to `selected={selectedSignal ? [selectedSignal] : []}` if it isn't already an array.)

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual verification**

Run dev server. Toggle ALL/ACTIVE. Expected: ACTIVE shrinks the list to signals with at least one frame in the buffer; ALL shows all signals. Reload the page; the toggle should remember its state.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/widgets.tsx app/src/components/dir-dock.tsx
git commit -m "add ALL/ACTIVE filter toggle to signal sidebar"
```

---

## Task 3: Make signal rows draggable

**Files:**
- Modify: `app/src/components/widgets.tsx` — add `draggable` and `onDragStart` to the signal `<div>` rendered for each signal in `SignalPicker`

- [ ] **Step 1: Add drag attributes to signal rows**

In `widgets.tsx`, find the per-signal `<div>` inside the `SignalPicker` list (around line 940 — the one with `onClick={() => onPick && onPick(s.id)}`). Add `draggable` and `onDragStart`. The dataTransfer payload uses a custom MIME type so other drop targets don't accidentally accept text/plain.

Replace the opening tag of that `<div>` with:

```tsx
<div
  key={s.id}
  draggable
  onDragStart={(e) => {
    e.dataTransfer.setData('application/x-nfr-signal', String(s.id));
    e.dataTransfer.effectAllowed = 'copy';
  }}
  onClick={() => onPick && onPick(s.id)}
  style={{
    padding: '5px 10px 5px 12px', display: 'flex', alignItems: 'center', gap: 8,
    cursor: 'grab', background: sel ? 'rgba(167,139,250,0.14)' : 'transparent',
    fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
    color: sel ? SH_COLORS.text : '#c8cbd0',
    borderLeft: sel ? `2px solid ${SH_COLORS.accentBright}` : '2px solid transparent',
  }}
  onMouseEnter={(e) => { if (!sel) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
  onMouseLeave={(e) => { if (!sel) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
>
```

(The only diff vs. the current code is `draggable`, `onDragStart`, and `cursor: 'grab'` instead of `cursor: 'pointer'`.)

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify drag visually**

Run dev. Pick up a signal row with the mouse. Expected: cursor changes to a drag indicator; the browser shows a drag image of the row. (No drop target yet — that's Task 5.)

- [ ] **Step 4: Commit**

```bash
git add app/src/components/widgets.tsx
git commit -m "make signal rows draggable, payload = signal id"
```

---

## Task 4: Drop-action helper + tests + type popup component

**Files:**
- Create: `app/src/components/dropAction.ts` — pure helper that decides what to do with a drop given the drop target
- Create: `app/src/components/dropAction.test.ts` — unit tests
- Modify: `app/src/components/dir-dock.tsx` — add `<DropTypePopup>` rendered conditionally based on a state set by the drop handler (handler itself is wired in Task 5)

- [ ] **Step 1: Write the failing test**

Create `app/src/components/dropAction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decideDropAction } from './dropAction.ts';

describe('decideDropAction', () => {
  it('returns choose-type when there is no target widget', () => {
    expect(decideDropAction(null, 'BMS_SOC')).toEqual({
      kind: 'chooseType',
      signalId: 'BMS_SOC',
    });
  });

  it('appends signal to a graph widget without duplicating', () => {
    const w = { id: 'w1', type: 'graph', signals: ['A'] } as const;
    expect(decideDropAction(w, 'B')).toEqual({
      kind: 'patch',
      widgetId: 'w1',
      next: { ...w, signals: ['A', 'B'] },
    });
    expect(decideDropAction(w, 'A')).toEqual({
      kind: 'patch',
      widgetId: 'w1',
      next: w,
    });
  });

  it('replaces the signal on numeric and gauge widgets', () => {
    const w = { id: 'w1', type: 'numeric', signals: ['A'] } as const;
    expect(decideDropAction(w, 'B')).toEqual({
      kind: 'patch',
      widgetId: 'w1',
      next: { ...w, signals: ['B'] },
    });
  });

  it('is a no-op when dropping on a g-g widget', () => {
    const w = { id: 'w1', type: 'gg', signals: [] } as const;
    expect(decideDropAction(w, 'X_Axis_Acceleration_Uncompensated')).toEqual({
      kind: 'noop',
    });
  });

  it('treats bar and heatmap as multi-signal like graph', () => {
    for (const type of ['bar', 'heatmap'] as const) {
      const w = { id: 'w1', type, signals: ['A'] };
      expect(decideDropAction(w, 'B')).toEqual({
        kind: 'patch',
        widgetId: 'w1',
        next: { ...w, signals: ['A', 'B'] },
      });
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd app && npx vitest run src/components/dropAction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `app/src/components/dropAction.ts`:

```ts
type Widget = {
  id: string;
  type: string;
  signals: any[];
};

export type DropAction =
  | { kind: 'chooseType'; signalId: any }
  | { kind: 'patch'; widgetId: string; next: Widget }
  | { kind: 'noop' };

const MULTI = new Set(['graph', 'bar', 'heatmap']);
const SINGLE = new Set(['numeric', 'gauge']);

export function decideDropAction(widget: Widget | null, signalId: any): DropAction {
  if (widget === null) return { kind: 'chooseType', signalId };
  if (widget.type === 'gg') return { kind: 'noop' };
  if (MULTI.has(widget.type)) {
    if (widget.signals.includes(signalId)) {
      return { kind: 'patch', widgetId: widget.id, next: widget };
    }
    return {
      kind: 'patch',
      widgetId: widget.id,
      next: { ...widget, signals: [...widget.signals, signalId] },
    };
  }
  if (SINGLE.has(widget.type)) {
    return {
      kind: 'patch',
      widgetId: widget.id,
      next: { ...widget, signals: [signalId] },
    };
  }
  return { kind: 'noop' };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd app && npx vitest run src/components/dropAction.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Implement the type-picker popup component**

Add this component above the `Dock` (or wherever the main exported component lives) in `dir-dock.tsx`. It renders a centered modal that lists the four signal-accepting widget types. `gg` is excluded.

```tsx
const DROPPABLE_TYPES = [
  { id: 'graph', label: 'GRAPH', icon: 'graph' },
  { id: 'numeric', label: 'NUMERIC', icon: 'num' },
  { id: 'gauge', label: 'GAUGE', icon: 'gauge' },
  { id: 'bar', label: 'BAR', icon: 'bar' },
  { id: 'heatmap', label: 'HEATMAP', icon: 'heat' },
];

function DropTypePopup({
  onPick,
  onCancel,
}: {
  onPick: (type: string) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: SH_COLORS.bg,
          border: `1px solid ${SH_COLORS.border}`,
          padding: 16,
          minWidth: 240,
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: 1.5, color: SH_COLORS.textMute, marginBottom: 10 }}>
          DISPLAY AS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {DROPPABLE_TYPES.map((wt) => (
            <button
              key={wt.id}
              onClick={() => onPick(wt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', background: 'transparent',
                color: SH_COLORS.text, border: `1px solid ${SH_COLORS.border}`,
                fontSize: 11, letterSpacing: 1, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <WidgetIcon kind={wt.icon} />
              <span>{wt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Note: this component depends on `WidgetIcon` and `SH_COLORS` already imported into `dir-dock.tsx`. Verify those imports are present; add them if not.

- [ ] **Step 6: Wire popup state (rendering only — drop handler comes in Task 5)**

In the main `Dock` component, add state for the pending drop and render the popup conditionally. The drop handler in Task 5 will populate this state.

```tsx
const [pendingDrop, setPendingDrop] = useState<{ signalId: any } | null>(null);
// …existing JSX…
{pendingDrop && (
  <DropTypePopup
    onCancel={() => setPendingDrop(null)}
    onPick={(type) => {
      addWidget(type, pendingDrop.signalId);
      setPendingDrop(null);
    }}
  />
)}
```

You'll need to extend `addWidget` to accept an optional signal id override; modify it from:

```tsx
const addWidget = (type: string) => {
  const sig = selectedSignal || 'Inverter_RPM';
```

to:

```tsx
const addWidget = (type: string, signalOverride?: any) => {
  const sig = signalOverride ?? selectedSignal ?? 'Inverter_RPM';
```

- [ ] **Step 7: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/dropAction.ts app/src/components/dropAction.test.ts app/src/components/dir-dock.tsx
git commit -m "add drop-action router + type-picker popup"
```

---

## Task 5: Wire drop handler on the grid

**Files:**
- Modify: `app/src/components/dir-dock.tsx` — `onDragOver` + `onDrop` on the grid container; per-widget drop targets that consume drops first via `e.stopPropagation()`

- [ ] **Step 1: Add drop handlers to the grid**

Find the grid `<div ref={gridRef} ...>` in `dir-dock.tsx` (around line 425). Add `onDragOver` (so the drop is allowed) and `onDrop` (handles drops on empty grid space — drops on existing widgets stop propagation in their own handler).

```tsx
<div
  ref={gridRef}
  onDragOver={(e) => {
    if (e.dataTransfer.types.includes('application/x-nfr-signal')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }}
  onDrop={(e) => {
    const sid = e.dataTransfer.getData('application/x-nfr-signal');
    if (!sid) return;
    e.preventDefault();
    setPendingDrop({ signalId: sid });
  }}
  style={{ /* …existing style… */ }}
>
```

- [ ] **Step 2: Add per-widget drop handlers**

Each widget cell (the `<div>` rendered inside the `widgets.map((w) => …)` loop, around line 436) gets its own `onDragOver`/`onDrop` that consumes the event and routes via `decideDropAction`.

Add the import at the top:

```tsx
import { decideDropAction } from './dropAction.ts';
```

Replace the per-widget `<div>` opening tag (currently `<div key={w.id} style={{ … }}>`) with:

```tsx
<div
  key={w.id}
  onDragOver={(e) => {
    if (e.dataTransfer.types.includes('application/x-nfr-signal')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      e.stopPropagation();
    }
  }}
  onDrop={(e) => {
    const sid = e.dataTransfer.getData('application/x-nfr-signal');
    if (!sid) return;
    e.preventDefault();
    e.stopPropagation();
    const action = decideDropAction(w, sid);
    if (action.kind === 'patch') {
      patch(w.id, action.next);
    }
    // 'noop' for g-g; 'chooseType' shouldn't happen here since w !== null.
  }}
  style={{ /* …existing style… */ }}
>
```

(`patch` is the existing helper used in this file at line 508: `patch(w.id, { signals: ... })`. It applies a partial widget update. Pass the full `next` widget — `patch` should merge or replace properly; if the existing impl strictly merges, replace the call with whatever is equivalent in this file. Skim the helper definition near line 100 if needed.)

- [ ] **Step 3: Run all tests**

Run: `cd app && npx vitest run`
Expected: all tests pass, including `dropAction.test.ts`.

- [ ] **Step 4: Visual verification — full flow**

Run: `cd app && npm run dev` (and the desktop server). In the dashboard:

1. Drag a signal from the sidebar onto an empty area of the widget grid. Expected: type popup appears. Pick "GRAPH". A new graph widget appears at the bottom with that signal.
2. Drag a different signal onto the new graph widget. Expected: signal is added (no popup).
3. Drag a signal onto a numeric widget. Expected: numeric widget's signal is replaced (no popup).
4. Drag a signal onto the g-g widget. Expected: nothing happens (no popup, no change).
5. Open the popup, press Escape. Expected: popup closes without creating a widget.
6. Open the popup, click the dimmed background. Expected: popup closes.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/dir-dock.tsx
git commit -m "wire signal drag-drop into the widget grid"
```

---

## Self-review

**Spec coverage:** Each section of the spec maps to a task — g-g rewrite (Task 1), filter toggle (Task 2), draggable rows (Task 3), drop-action helper + popup (Task 4), drop-handler wiring (Task 5).

**Placeholder scan:** No TBDs, no "add appropriate", no "similar to". Each step has full code or an exact command.

**Type consistency:** `Widget` shape used in `dropAction.ts` matches the runtime widget objects in `dir-dock.tsx` (`{id, type, signals, ...}`); `addWidget` signature change is consistent across Task 4 wiring; `decideDropAction` return type is enumerated and exhaustively handled.
