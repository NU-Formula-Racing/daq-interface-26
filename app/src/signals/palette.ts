// Distinct color per real DBC source, plus a deterministic hash fallback for
// any unknown source (e.g. after a custom DBC upload).
export const GROUP_COLORS: Record<string, string> = {
  // Battery / high-voltage
  BMS: '#e06c6c',          // red
  BMS_SOE: '#e06c6c',
  HV: '#e06c6c',

  // Power
  PDM: '#e0b066',          // amber

  // Engine control / drivetrain
  ECU: '#a78bfa',          // purple
  'Rear Inverter': '#e08a5a',         // burnt orange
  'Front-Left-Inverter': '#d97aab',   // magenta
  'Front-Right-Inverter': '#e08a8a',  // coral
  Inverter: '#e08a5a',

  // Sensors
  'DAQ-IMU': '#67d4f0',    // cyan
  'DAQ-Telemetry': '#f0d066', // gold

  // Per-corner wheels (4 distinct hues, all in the cool family for cohesion)
  'DAQ-FL-Wheel': '#8ba6df', // light blue
  'DAQ-FR-Wheel': '#7ec98f', // green
  'DAQ-RL-Wheel': '#7c6fde', // indigo
  'DAQ-BL-Wheel': '#7c6fde',
  'DAQ-RR-Wheel': '#6ec5c5', // mint
  'DAQ-BR-Wheel': '#6ec5c5',

  // Misc
  'CAN2USB Error Frame': '#999999',
  Thermal: '#e08a5a',
  Coolant: '#e08a5a',
  Suspension: '#8ba6df',
  Damper: '#8ba6df',
  Brake: '#7ec98f',
  Driver: '#a78bfa',
  Steering: '#a78bfa',
  GPS: '#67d4f0',
};

const FALLBACKS = [
  '#e0b066', '#e06c6c', '#e08a5a', '#8ba6df',
  '#7ec98f', '#a78bfa', '#67d4f0', '#d97aab',
  '#7c6fde', '#6ec5c5', '#f0d066', '#e08a8a',
];

export function colorForSource(source: string): string {
  if (GROUP_COLORS[source]) return GROUP_COLORS[source];
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) | 0;
  return FALLBACKS[Math.abs(h) % FALLBACKS.length];
}
