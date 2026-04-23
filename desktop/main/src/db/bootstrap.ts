import { Client } from 'pg';
import { runMigrations } from './migrate.ts';

export interface BootstrapOptions {
  connectionString: string;
  migrationsDir: string;
}

export interface BootstrapResult {
  client: Client;
  applied: string[];
}

export async function bootstrapDatabase(
  opts: BootstrapOptions
): Promise<BootstrapResult> {
  const client = new Client({ connectionString: opts.connectionString });
  await client.connect();
  try {
    const applied = await runMigrations(client, opts.migrationsDir);
    return { client, applied };
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
}
