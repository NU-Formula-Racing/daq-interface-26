/**
 * Map-backed LRU. Map preserves insertion order; deleting + re-setting moves
 * a key to most-recent. On overflow we evict the first key.
 */
export class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private cap: number) {
    if (cap <= 0) throw new Error('LRU cap must be > 0');
  }

  get size(): number { return this.map.size; }

  has(key: K): boolean { return this.map.has(key); }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: K): boolean { return this.map.delete(key); }

  clear(): void { this.map.clear(); }
}
