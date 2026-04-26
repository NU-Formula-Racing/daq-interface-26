import type { SignalDefinition } from '../api/types.ts';
import { colorForSource } from './palette.ts';
import overlay from './metadata.json';

export type SignalKind = 'line' | 'area' | 'step' | 'slow' | 'bool' | 'ac';

export interface Signal {
  id: number;
  name: string;
  unit: string;
  group: string;
  groupName: string;
  color: string;
  min: number;
  max: number;
  kind: SignalKind;
}

export interface SignalGroup {
  id: string;
  name: string;
  color: string;
  signals: Signal[];
}

export interface SignalCatalog {
  ALL: Signal[];
  GROUPS: SignalGroup[];
  byId: (id: number) => Signal | null;
  byName: (name: string) => Signal | null;
  /** Accepts a numeric id OR a string. Strings can be `"signal_name"` or
   *  `"Source/signal_name"` — first match wins. */
  resolve: (idOrName: number | string) => Signal | null;
}

interface OverlayEntry {
  min?: number;
  max?: number;
  kind?: SignalKind;
}

const OVERLAY = overlay as Record<string, OverlayEntry>;

function overlayFor(source: string, name: string): OverlayEntry {
  return OVERLAY[`${source}/${name}`] ?? {};
}

export function buildCatalog(defs: SignalDefinition[]): SignalCatalog {
  const signals: Signal[] = defs.map((d) => {
    const ov = overlayFor(d.source, d.signal_name);
    return {
      id: d.id,
      name: d.signal_name,
      unit: d.unit ?? '',
      group: d.source,
      groupName: d.source,
      color: colorForSource(d.source),
      min: ov.min ?? 0,
      max: ov.max ?? 1,
      kind: ov.kind ?? 'line',
    };
  });

  const groupMap = new Map<string, SignalGroup>();
  for (const s of signals) {
    if (!groupMap.has(s.group)) {
      groupMap.set(s.group, {
        id: s.group,
        name: s.groupName,
        color: s.color,
        signals: [],
      });
    }
    groupMap.get(s.group)!.signals.push(s);
  }
  const GROUPS = Array.from(groupMap.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const byIdMap = new Map(signals.map((s) => [s.id, s] as const));
  const byNameMap = new Map<string, Signal>();
  for (const s of signals) {
    const lname = s.name.toLowerCase();
    if (!byNameMap.has(lname)) byNameMap.set(lname, s);
    byNameMap.set(`${s.group}/${s.name}`.toLowerCase(), s);
  }

  const byName = (q: string): Signal | null =>
    byNameMap.get(q.toLowerCase()) ?? null;

  const resolve = (x: number | string): Signal | null => {
    if (typeof x === 'number') return byIdMap.get(x) ?? null;
    if (typeof x === 'string') {
      const asNum = Number(x);
      if (!Number.isNaN(asNum) && byIdMap.has(asNum)) return byIdMap.get(asNum)!;
      return byName(x);
    }
    return null;
  };

  return {
    ALL: signals,
    GROUPS,
    byId: (id) => byIdMap.get(id) ?? null,
    byName,
    resolve,
  };
}
