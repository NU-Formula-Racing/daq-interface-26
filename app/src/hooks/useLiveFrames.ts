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
