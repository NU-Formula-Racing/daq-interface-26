// duckdb is loaded lazily so the app can boot even when the native binding
// is unavailable (e.g. packaged build without a rebuilt prebuilt). Upload
// and pull flows fail with a clear error at click time instead of crashing
// the whole desktop on startup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DuckDbModule = any;
let _duckdb: DuckDbModule | null = null;
function loadDuckDb(): DuckDbModule {
  if (_duckdb) return _duckdb;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _duckdb = require('duckdb');
    return _duckdb;
  } catch (e) {
    throw new Error(
      'duckdb native binding not available — upload and pull are disabled. ' +
      'Rebuild with `npm rebuild duckdb` or rerun electron-builder with npmRebuild enabled. ' +
      `(${(e as Error).message})`,
    );
  }
}

/** A short-lived DuckDB instance for a single Parquet read or write. */
export class DuckDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private conn: any;

  constructor() {
    const duckdb = loadDuckDb();
    this.db = new duckdb.Database(':memory:');
    this.conn = this.db.connect();
  }

  /** Run a parameterised statement and resolve when it completes. */
  run(sql: string, ...params: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.run(sql, ...params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Run a query and return all rows. */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.conn.all as any)(sql, ...params, (err: Error | null, rows: T[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.conn.close(() => this.db.close(() => resolve()));
    });
  }
}

/** Attaches local Postgres as a DuckDB schema named `pg`. */
export async function attachPostgres(d: DuckDB, connStr: string): Promise<void> {
  await d.run(`INSTALL postgres`);
  await d.run(`LOAD postgres`);
  await d.run(`ATTACH '${connStr.replace(/'/g, "''")}' AS pg (TYPE POSTGRES, READ_ONLY)`);
}
