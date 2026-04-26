import { useEffect, useSyncExternalStore, useState } from 'react';
import { subscribeLive } from '../api/ws.ts';
import type { ParserEvent } from '../api/types.ts';

export interface FrameRow {
  ts: string;
  signal_id: number;
  value: number;
}

interface FramesStoreOptions {
  bufferSize?: number;
}

export class FramesStore {
  private ringBySignal = new Map<number, FrameRow[]>();
  private latestBySignal = new Map<number, FrameRow>();
  private listeners = new Set<() => void>();
  private bufferSize: number;
  private version = 0;
  private _firstTs: string | null = null;
  private _latestTs: string | null = null;

  constructor(opts: FramesStoreOptions = {}) {
    this.bufferSize = opts.bufferSize ?? 300;
  }

  push(rows: FrameRow[]): void {
    for (const r of rows) {
      this.latestBySignal.set(r.signal_id, r);
      let buf = this.ringBySignal.get(r.signal_id);
      if (!buf) {
        buf = [];
        this.ringBySignal.set(r.signal_id, buf);
      }
      buf.push(r);
      if (buf.length > this.bufferSize) buf.shift();

      if (this._firstTs === null || r.ts < this._firstTs) this._firstTs = r.ts;
      if (this._latestTs === null || r.ts > this._latestTs) this._latestTs = r.ts;
    }
    this.version++;
    for (const l of this.listeners) l();
  }

  latest(signalId: number): FrameRow | null {
    return this.latestBySignal.get(signalId) ?? null;
  }

  series(signalId: number): FrameRow[] {
    return this.ringBySignal.get(signalId) ?? [];
  }

  /** ISO timestamp of the very first frame seen since the last reset(). */
  firstTs(): string | null {
    return this._firstTs;
  }

  /** ISO timestamp of the most recent frame seen. */
  latestTs(): string | null {
    return this._latestTs;
  }

  /** Drop everything — call when a new session starts. */
  reset(): void {
    this.ringBySignal.clear();
    this.latestBySignal.clear();
    this._firstTs = null;
    this._latestTs = null;
    this.version++;
    for (const l of this.listeners) l();
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function useLiveFrames(): FramesStore {
  const [store] = useState(() => new FramesStore());
  useEffect(() => {
    const sub = subscribeLive((ev: ParserEvent) => {
      if (ev.type === 'frames') store.push(ev.rows);
    });
    return () => sub.close();
  }, [store]);
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getVersion(),
    () => 0,
  );
  return store;
}
