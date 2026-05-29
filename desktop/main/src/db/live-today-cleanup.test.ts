import { describe, it, expect } from 'vitest';
import { buildLiveTodayCleanupSql } from './live-today-cleanup.ts';

describe('buildLiveTodayCleanupSql', () => {
  it('returns a DELETE keyed on today Chicago midnight', () => {
    const sql = buildLiveTodayCleanupSql();
    expect(sql).toMatch(/DELETE FROM live_today/);
    expect(sql).toMatch(/America\/Chicago/);
    expect(sql).toMatch(/ts <\s*\(now\(\) AT TIME ZONE 'America\/Chicago'\)::date AT TIME ZONE 'America\/Chicago'/);
  });
});
