// JetBrains-inspired softer palette — warm grays over pure black.
// Source of truth: app/design-reference/project/lib/widgets.jsx (W_COLORS).
// shell.jsx uses `const SH_COLORS = W_COLORS;` so there is only one palette.
export const COLORS = {
  bg: '#2b2d30',         // panel bg (JetBrains "dark gray")
  bgInner: '#1e1f22',    // plot / input bg
  bgElev: '#3c3f41',     // hovered rows, chips
  grid: 'rgba(255,255,255,0.05)',
  gridMid: 'rgba(255,255,255,0.09)',
  axis: 'rgba(220,221,222,0.45)',
  text: '#dfe1e5',
  textMute: '#9da0a8',
  textFaint: '#6f7278',
  border: 'rgba(255,255,255,0.09)',
  accent: '#7c6fde',
  accentBright: '#a78bfa',
  warn: '#f0a55c',
  err: '#e06c6c',
  ok: '#7ec98f',
};
