import { describe, it, expect, beforeAll } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSpaces } from './spaces.ts';

const spaces = makeSpaces({
  endpoint: process.env.MINIO_URL!,
  region: 'us-east-1',
  bucket: 'test-bucket',
  accessKey: 'test',
  secretKey: 'testtest',
  forcePathStyle: true,
});

beforeAll(async () => { await spaces.ensureBucket(); });

describe('Spaces wrapper', () => {
  it('round-trips a small file with byte-equal verify', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sp-'));
    const local = join(dir, 'hello.bin');
    await writeFile(local, Buffer.from('hello world'));
    await spaces.putFile('greetings/hello.bin', local);
    const head = await spaces.head('greetings/hello.bin');
    expect(head.contentLength).toBe(11);
    const probe = await spaces.probeBytes('greetings/hello.bin', 0, 4);
    expect(probe.toString()).toBe('hell');
  });
});
