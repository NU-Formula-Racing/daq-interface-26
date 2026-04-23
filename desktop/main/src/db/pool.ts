import pg from 'pg';

const { Pool } = pg;

export interface PoolOptions {
  connectionString: string;
  max?: number;
}

/**
 * A small Pool wrapper. Prefer this over the one-shot Client returned
 * by `bootstrapDatabase` for route handlers; connections come and go
 * as requests arrive.
 */
export function createPool(opts: PoolOptions): pg.Pool {
  return new Pool({
    connectionString: opts.connectionString,
    max: opts.max ?? 10,
  });
}
