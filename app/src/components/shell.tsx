// Shared UI bits: SignalPicker, SignalChip, Timeline, TopBar, WidgetShell.
// All three directions (Dock/Console/Bench) compose these.
//
// The original design-reference/project/lib/shell.jsx stored these components
// separately. In this port they live alongside the gauge/graph primitives in
// widgets.tsx and are re-exported here so callers can keep the mental model of
// "shell owns the chrome; widgets owns the tiles" — which matches how the
// design file is organized.
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
} from './widgets.tsx';
