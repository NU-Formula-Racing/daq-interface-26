import { describe, it, expect } from 'vitest';
import { buildManifest, sessionContentHash } from './manifest.ts';

describe('manifest', () => {
  it('builds a manifest with files sorted by source', () => {
    const m = buildManifest({
      sessionId: '00000000-0000-0000-0000-000000000001',
      createdAt: '2026-05-24T00:00:00.000Z',
      files: [
        { source: 'PDM', objectKey: 'sessions/x/PDM.parquet', bytes: 10, rowCount: 1, sha256: 'b'.repeat(64) },
        { source: 'BMS', objectKey: 'sessions/x/BMS.parquet', bytes: 20, rowCount: 2, sha256: 'a'.repeat(64) },
      ],
    });
    expect(m.files.map((f) => f.source)).toEqual(['BMS', 'PDM']);
    expect(m.manifest_version).toBe(1);
    expect(m.session_content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('session_content_hash is order-independent over inputs', () => {
    const h1 = sessionContentHash([
      { source: 'A', sha256: '1'.repeat(64) },
      { source: 'B', sha256: '2'.repeat(64) },
    ]);
    const h2 = sessionContentHash([
      { source: 'B', sha256: '2'.repeat(64) },
      { source: 'A', sha256: '1'.repeat(64) },
    ]);
    expect(h1).toBe(h2);
  });
});
