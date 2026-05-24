import { createHash } from 'node:crypto';

export interface ManifestFile {
  source: string;
  objectKey: string;
  bytes: number;
  rowCount: number;
  sha256: string;
}

export interface Manifest {
  session_id: string;
  manifest_version: 1;
  created_at: string;
  files: Array<{
    source: string;
    object_key: string;
    bytes: number;
    row_count: number;
    sha256: string;
  }>;
  session_content_hash: string;
}

export function sessionContentHash(
  files: Array<{ source: string; sha256: string }>,
): string {
  const sorted = [...files].sort((a, b) => a.source.localeCompare(b.source));
  const h = createHash('sha256');
  for (const f of sorted) {
    h.update(f.source);
    h.update('\0');
    h.update(f.sha256);
    h.update('\n');
  }
  return h.digest('hex');
}

export function buildManifest(input: {
  sessionId: string;
  createdAt: string;
  files: ManifestFile[];
}): Manifest {
  const sortedFiles = [...input.files].sort((a, b) =>
    a.source.localeCompare(b.source),
  );
  return {
    session_id: input.sessionId,
    manifest_version: 1,
    created_at: input.createdAt,
    files: sortedFiles.map((f) => ({
      source: f.source,
      object_key: f.objectKey,
      bytes: f.bytes,
      row_count: f.rowCount,
      sha256: f.sha256,
    })),
    session_content_hash: sessionContentHash(sortedFiles),
  };
}

export function parseManifest(raw: string): Manifest {
  const m = JSON.parse(raw) as Manifest;
  if (m.manifest_version !== 1) {
    throw new Error(`unsupported manifest_version: ${m.manifest_version}`);
  }
  return m;
}
