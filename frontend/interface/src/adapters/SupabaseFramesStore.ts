import type { FrameRow, FramesStore } from '@nfr/widgets';

export interface RpcRow {
  ts: string;
  signal_id: number;
  value_avg: number;
  value_min: number;
  value_max: number;
  sample_n: number;
  signal_name?: string;
  unit?: string;
}

export class SupabaseFramesStore implements FramesStore {
  private bySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  ingest(rows: RpcRow[]): void {
    const touched = new Set<number>();
    for (const r of rows) {
      const frame: FrameRow = {
        ts: r.ts,
        signal_id: r.signal_id,
        value: r.value_avg,
        vMin: r.value_min,
        vMax: r.value_max,
      };
      let buf = this.bySignal.get(r.signal_id);
      if (!buf) { buf = []; this.bySignal.set(r.signal_id, buf); }
      buf.push(frame);
      touched.add(r.signal_id);

      const prev = this.latestBySignal.get(r.signal_id);
      if (!prev || prev.ts < frame.ts) this.latestBySignal.set(r.signal_id, frame);

      if (this._firstTs === null || frame.ts < this._firstTs) this._firstTs = frame.ts;
      if (this._latestTs === null || frame.ts > this._latestTs) this._latestTs = frame.ts;
    }
    for (const id of touched) {
      this.bySignal.get(id)!.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  series(signalId: number): FrameRow[] {
    return this.bySignal.get(signalId) ?? [];
  }
  latest(signalId: number): FrameRow | null {
    return this.latestBySignal.get(signalId) ?? null;
  }
  firstTs(): string | null { return this._firstTs; }
  latestTs(): string | null { return this._latestTs; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  getVersion(): number { return this.version; }
  reset(): void {
    this.bySignal.clear();
    this.latestBySignal.clear();
    this._firstTs = null;
    this._latestTs = null;
    this.version++;
    for (const l of this.listeners) l();
  }
}
