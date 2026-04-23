import { Client } from 'pg';
import { randomBytes } from 'crypto';

const ADMIN_URL =
  process.env.TEST_PG_URL ?? 'postgres://postgres@localhost:5432/postgres';

export interface ScratchDb {
  url: string;
  name: string;
  client: Client;
  drop: () => Promise<void>;
}

export async function createScratchDb(): Promise<ScratchDb> {
  const name = `nfr_test_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  return {
    url: url.toString(),
    name,
    client,
    drop: async () => {
      await client.end().catch(() => {});
      const a = new Client({ connectionString: ADMIN_URL });
      await a.connect();
      try {
        await a.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
          [name]
        );
        await a.query(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await a.end();
      }
    },
  };
}
