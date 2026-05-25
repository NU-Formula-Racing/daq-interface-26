import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makePublicSpaces } from './spaces-public.ts';

let server: http.Server;
let baseUrl: string;

const manifestBody = JSON.stringify({
  session_id: 'a', manifest_version: 1, files: [],
  session_content_hash: 'h',
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/sessions/abc/manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(manifestBody);
      return;
    }
    if (req.method === 'GET' && req.url === '/sessions/abc/PDM.parquet') {
      res.writeHead(200, { 'content-type': 'application/octet-stream',
        'content-length': '5' });
      res.end(Buffer.from('hello'));
      return;
    }
    if (req.method === 'HEAD' && req.url === '/sessions/abc/PDM.parquet') {
      res.writeHead(200, { 'content-length': '5' });
      res.end();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('makePublicSpaces', () => {
  it('fetches and parses a manifest', async () => {
    const ps = makePublicSpaces(baseUrl);
    const m = await ps.fetchManifest('abc');
    expect(m.session_id).toBe('a');
  });

  it('HEAD returns content length', async () => {
    const ps = makePublicSpaces(baseUrl);
    const { contentLength } = await ps.head('sessions/abc/PDM.parquet');
    expect(contentLength).toBe(5);
  });

  it('streams a parquet to disk and computes sha256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sp-pub-'));
    const dest = join(dir, 'PDM.parquet');
    const ps = makePublicSpaces(baseUrl);
    const result = await ps.fetchToFile('sessions/abc/PDM.parquet', dest);
    expect(result.bytes).toBe(5);
    expect(result.sha256).toBe(
      createHash('sha256').update(Buffer.from('hello')).digest('hex'),
    );
    expect(await readFile(dest)).toEqual(Buffer.from('hello'));
  });

  it('throws on 404', async () => {
    const ps = makePublicSpaces(baseUrl);
    await expect(ps.fetchManifest('nope')).rejects.toThrow(/404/);
  });
});
