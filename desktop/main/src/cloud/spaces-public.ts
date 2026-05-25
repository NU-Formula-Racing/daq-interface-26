import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Manifest } from '../parquet/manifest.ts';
import { parseManifest } from '../parquet/manifest.ts';

export interface PublicSpaces {
  fetchManifest: (sessionId: string) => Promise<Manifest>;
  /** GET the object, stream to disk, return bytes + sha256. */
  fetchToFile: (objectKey: string, localPath: string) =>
    Promise<{ bytes: number; sha256: string }>;
  head: (objectKey: string) => Promise<{ contentLength: number }>;
}

export function makePublicSpaces(publicBase: string): PublicSpaces {
  const base = publicBase.replace(/\/$/, '');
  const url = (key: string) => `${base}/${key.replace(/^\//, '')}`;

  return {
    async fetchManifest(sessionId) {
      const u = url(`sessions/${sessionId}/manifest.json`);
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} fetching ${u}`);
      return parseManifest(await r.text());
    },
    async fetchToFile(objectKey, localPath) {
      const u = url(objectKey);
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${r.status} fetching ${u}`);
      if (!r.body) throw new Error(`empty body for ${u}`);
      const hash = createHash('sha256');
      let bytes = 0;
      const ws = createWriteStream(localPath);
      const src = Readable.fromWeb(r.body as unknown as import('stream/web').ReadableStream);
      src.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
      await pipeline(src, ws);
      return { bytes, sha256: hash.digest('hex') };
    },
    async head(objectKey) {
      const u = url(objectKey);
      const r = await fetch(u, { method: 'HEAD' });
      if (!r.ok) throw new Error(`${r.status} HEAD ${u}`);
      const len = r.headers.get('content-length');
      return { contentLength: len ? Number(len) : 0 };
    },
  };
}
