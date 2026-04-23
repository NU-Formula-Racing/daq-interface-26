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
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) | 0;
  return FALLBACKS[Math.abs(h) % FALLBACKS.length];
}
