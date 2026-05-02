# G-G plot fix and drag-drop signal UX

Two changes to the dashboard:

1. Fix the existing G-G plot widget (currently renders blank).
2. Replace the click-then-add UX for placing signals into widgets with a
   drag-and-drop flow, plus a sidebar filter for "only signals with data".

Both ship together because the second one will exercise the first as soon as
it lands.

## 1. G-G plot fix

### Behavior

- **X axis**: `X_Axis_Acceleration_Uncompensated / 9.81` (g)
- **Y axis**: `Y_Axis_Acceleration_Uncompensated / 9.81` (g)
- No sign flips, no axis swaps. Labels read "X (g)" and "Y (g)". Letting the
  user infer which physical direction is which avoids guessing IMU mounting.
- Range: square, symmetric, auto-fit to data with a minimum half-range of
  ±2g so the friction-circle reference rings always show.
- Reference rings at 0.5 g, 1 g (highlighted), 1.5 g, and 2 g — circles
  centered on origin.
- Recent samples (last 30) drawn brighter to give the trail direction.

### Bug to fix

The previous implementation looked correct on paper but rendered no points
in real sessions where individual line graphs of the same signals worked
fine. Likely culprits to address:

- **Sign flip + sequencing math** in the prior version was harder to
  visually verify; the simpler design above removes the indirection.
- **Initial size**: `viewBox` was driven by a `useState` that started at
  `(320, 240)` and only updated when `ResizeObserver` fired. Render the
  SVG using percent dimensions and compute geometry from a measured
  container; if the container hasn't laid out yet, fall back to the
  default and re-render once it has.
- **Empty-data path**: when `frames.series(...)` returns `[]` for either
  axis, render the empty plot (rings + axes) instead of bailing out so it
  visually matches the rest of the app's "ready but no data" treatment.

### What stays the same

- Widget is registered in `WIDGET_TYPES` as `gg`.
- Header shows "IMU lateral × longitudinal (fixed)" — no signal chips.
- Type-selector dropdown still skips g-g for the drop popup (see §2),
  because it doesn't accept dropped signals.
- Default size remains 5 cols × 7 rows so the plot is roughly square.

## 2. Sidebar filter: ALL / ACTIVE

A two-position segmented control above the signal list:

- **ALL** (default) — current behavior; every signal in the catalog.
- **ACTIVE** — only signals where the live frames store has at least one
  entry: `frames.series(sig.id).length > 0` (equivalently
  `frames.latest(sig.id) != null`).

The toggle re-evaluates as data streams in, so signals appear or disappear
in the list as the replay scrubber moves into windows that contain them.

State persists across page loads via `localStorage` under a key like
`nfr_signal_filter`.

## 3. Drag-and-drop signal → widget

### Drag source

Signal rows in the sidebar become draggable via the HTML5 drag API
(`draggable`, `onDragStart`). The drag payload is the signal id, set via
`event.dataTransfer.setData('application/x-nfr-signal', String(sig.id))`.
Default browser drag image is fine for v1.

### Drop targets

The widget grid area is the drop zone. `onDragOver` calls
`event.preventDefault()` so drop is allowed. `onDrop` reads the signal id
back out of `dataTransfer` and routes based on what was under the cursor:

| Drop landed on | Behavior |
|---|---|
| Empty grid space | Open the **type popup** (centered modal). Click a type → append a new widget at the bottom row with the signal pre-filled. |
| Existing widget where `type ∈ {graph, bar, heatmap}` (multi-signal) | Add the signal to the widget's `signals` array (deduped). No popup. |
| Existing widget where `type ∈ {numeric, gauge}` (single-signal) | Replace the widget's single signal. No popup. |
| Existing widget where `type === 'gg'` | No-op (widget ignores signals). |

### Type popup

A centered modal with one button per multi/single-signal widget type:

- GRAPH
- NUMERIC
- GAUGE
- BAR
- HEATMAP

`gg` is excluded — you can't drop a signal into a fixed-signal plot.

Dismissed by:
- Picking a type
- Clicking outside the modal
- Pressing Escape

### Existing toolbar buttons stay

The "+ GRAPH", "+ NUMERIC", … buttons in the layout toolbar continue to
work as today — they still create empty widgets with whatever signal is
"selected" via the click path. Drag-and-drop is an additional, faster
path, not a replacement. Removing the toolbar would break the g-g
flow (since g-g doesn't accept dropped signals).

### Defaults that may need revisiting later

- **Drop landing position**: new widgets always append below the bottom
  row regardless of where the cursor was during drop. Pixel-to-cell
  drop placement is possible but adds layout math we can defer.
- **Drag preview**: native browser default. No custom outline.
- **Toggle/filter scope**: per-laptop via `localStorage`, not synced to
  cloud or shared across devices.

## Files touched

- `app/src/components/widgets.tsx` — rewrite `GgPlotWidget` body, leave
  shell + registration intact.
- `app/src/components/dir-dock.tsx` — add `dragover`/`drop` handlers on
  the grid, type-popup component, route logic for drops. The signal
  list lives in this file's left panel via `<SignalPicker>`.
- `app/src/components/widgets.tsx` — `SignalPicker` (defined here)
  needs a new prop for the ALL/ACTIVE filter, and rows need a
  `draggable`/`onDragStart` hook that sets the signal id payload.

## Out of scope

- Custom drag image / drag preview styling.
- Pixel-precise drop placement.
- Server-synced toggle state.
- Customizing the g-g plot axes (still fixed; convention left to the
  reader).
