import { describe, it, expect } from 'vitest';
import { createScratchDb } from './pg.ts';

describe('createScratchDb', () => {
  it('creates and drops a throwaway database', async () => {
    const db = await createScratchDb();
    try {
      const { rows } = await db.client.query<{ datname: string }>(
        `SELECT current_database() as datname`
      );
      expect(rows[0].datname).toBe(db.name);
    } finally {
      await db.drop();
    }
  });
});
