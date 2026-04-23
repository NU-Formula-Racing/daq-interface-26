import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';

describe('runMigrations', () => {
  let db: ScratchDb;
  let migrationsDir: string;

  beforeEach(async () => {
    db = await createScratchDb();
    migrationsDir = mkdtempSync(join(tmpdir(), 'mig-'));
  });

  afterEach(async () => {
    await db.drop();
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  it('applies a single migration on a fresh DB and records it', async () => {
    writeFileSync(
      join(migrationsDir, '0001_init.sql'),
      'CREATE TABLE widgets (id INT PRIMARY KEY);'
    );

    await runMigrations(db.client, migrationsDir);

    const { rows: tables } = await db.client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'widgets'`
    );
    expect(tables).toHaveLength(1);

    const { rows: versions } = await db.client.query(
      `SELECT version FROM schema_migrations ORDER BY version`
    );
    expect(versions.map((r) => r.version)).toEqual(['0001_init']);
  });

  it('skips already-applied migrations on re-run', async () => {
    writeFileSync(
      join(migrationsDir, '0001_init.sql'),
      'CREATE TABLE widgets (id INT PRIMARY KEY);'
    );

    const first = await runMigrations(db.client, migrationsDir);
    expect(first).toEqual(['0001_init']);

    const second = await runMigrations(db.client, migrationsDir);
    expect(second).toEqual([]);
  });

  it('applies new migrations on top of existing ones in order', async () => {
    writeFileSync(
      join(migrationsDir, '0001_a.sql'),
      'CREATE TABLE a (id INT PRIMARY KEY);'
    );
    await runMigrations(db.client, migrationsDir);

    writeFileSync(
      join(migrationsDir, '0002_b.sql'),
      'CREATE TABLE b (id INT PRIMARY KEY);'
    );
    const applied = await runMigrations(db.client, migrationsDir);
    expect(applied).toEqual(['0002_b']);

    const { rows } = await db.client.query(
      `SELECT version FROM schema_migrations ORDER BY version`
    );
    expect(rows.map((r) => r.version)).toEqual(['0001_a', '0002_b']);
  });

  it('rolls back a failing migration and reports the failure', async () => {
    writeFileSync(
      join(migrationsDir, '0001_bad.sql'),
      'CREATE TABLE t (id INT PRIMARY KEY); SELECT * FROM no_such_table;'
    );

    await expect(runMigrations(db.client, migrationsDir)).rejects.toThrow(
      /Migration 0001_bad\.sql failed/
    );

    const { rows: tables } = await db.client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 't'`
    );
    expect(tables).toHaveLength(0);

    const { rows: versions } = await db.client.query(
      `SELECT version FROM schema_migrations`
    );
    expect(versions).toEqual([]);
  });
});
