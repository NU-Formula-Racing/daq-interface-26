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
  unit: string;
  min?: number;
  max?: number;
  description?: string;
}

export interface SignalGroup {
  id: string;
  name: string;
  signalIds: number[];
}

export interface SignalCatalog {
  all(): SignalDefinition[];
  resolve(id: number | string): SignalDefinition | null;
  groups(): SignalGroup[];
}
