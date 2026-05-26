export interface FrameRow {
  ts: string;          // ISO timestamp
  signal_id: number;
  value: number;       // = avg when bucketed, raw value otherwise
  vMin?: number;
  vMax?: number;
  /** Number of raw samples aggregated into this bucket. > 1 means the
   *  server averaged multiple raw samples; = 1 (or undefined) means the
   *  value is a single raw sample. Surfaced in the graph settings panel
   *  as the RAW / AGGREGATED indicator. */
  sampleN?: number;
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
