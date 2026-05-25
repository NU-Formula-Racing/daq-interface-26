import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { streamNdjsonGz } from './ndjson.ts';

describe('streamNdjsonGz', () => {
  it('yields one parsed object per line, ignoring blanks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ndjson-'));
    const path = join(dir, 'sample.ndjson.gz');
    const raw = '{"a":1}\n\n{"a":2}\n{"a":3}\n';
    await writeFile(path, gzipSync(Buffer.from(raw)));
    const got: Array<Record<string, number>> = [];
    for await (const row of streamNdjsonGz<{ a: number }>(path)) got.push(row);
    expect(got).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('returns nothing on a missing file', async () => {
    const got: unknown[] = [];
    for await (const row of streamNdjsonGz('/tmp/does-not-exist.ndjson.gz')) got.push(row);
    expect(got).toEqual([]);
  });
});
