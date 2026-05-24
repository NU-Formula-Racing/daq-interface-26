import duckdb from 'duckdb';

/** A short-lived DuckDB instance for a single Parquet read or write. */
export class DuckDB {
  private db: duckdb.Database;
  private conn: duckdb.Connection;

  constructor() {
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
      this.conn.all(sql, ...params, (err: Error | null, rows: T[]) => {
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
