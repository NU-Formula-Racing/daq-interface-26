export interface FrameRow {
  ts: string;          // ISO timestamp
  signal_id: number;
  value: number;       // = avg when bucketed, raw value otherwise
  vMin?: number;
  vMax?: number;
}

export interface FramesStore {
  series(signalId: number): FrameRow[];
  latest(signalId: number): FrameRow | null;
  firstTs(): string | null;
  latestTs(): string | null;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

export interface SignalDefinition {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  min?: number;
  max?: number;
  description?: string | null;
}

export type { Signal, SignalGroup, SignalCatalog, SignalKind } from '../signals/catalog.ts';
