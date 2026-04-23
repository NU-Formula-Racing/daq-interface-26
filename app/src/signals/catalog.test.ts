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
    expect(bms.color).toBe('#e06c6c');
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
