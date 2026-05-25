import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
  CreateBucketCommand, BucketAlreadyOwnedByYou, BucketAlreadyExists } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export interface SpacesConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
}

export interface SpacesClient {
  putFile: (key: string, localPath: string, contentType?: string) => Promise<void>;
  putBytes: (key: string, body: Buffer, contentType?: string) => Promise<void>;
  head: (key: string) => Promise<{ contentLength: number }>;
  getString: (key: string) => Promise<string>;
  probeBytes: (key: string, start: number, length: number) => Promise<Buffer>;
  ensureBucket: () => Promise<void>;
}

/**
 * Strip a leading bucket subdomain from an endpoint URL.
 *
 * DigitalOcean shows the bucket URL ("https://<bucket>.<region>.digitaloceanspaces.com")
 * in its Spaces tab, so users naturally paste that — but the S3 SDK then
 * composes "<bucket>.<endpoint>" and gets the bucket name twice in the host,
 * which fails TLS hostname verification. Normalize by removing the bucket
 * subdomain if present.
 */
export function normalizeEndpoint(endpoint: string, bucket: string): string {
  try {
    const u = new URL(endpoint);
    const prefix = `${bucket}.`;
    if (u.hostname.startsWith(prefix)) {
      u.hostname = u.hostname.slice(prefix.length);
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return endpoint;
  }
}

export function makeSpaces(cfg: SpacesConfig): SpacesClient {
  const endpoint = normalizeEndpoint(cfg.endpoint, cfg.bucket);
  const s3 = new S3Client({
    endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: cfg.forcePathStyle ?? false,
  });

  return {
    async putFile(key, localPath, contentType) {
      const st = await stat(localPath);
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: st.size,
        ContentType: contentType,
        // Web app reads parquet files directly from Spaces with no
        // credentials — make uploaded objects public so anonymous fetches
        // work. Session data is non-sensitive (CAN telemetry from the
        // team's own car) and URLs are UUID-keyed.
        ACL: 'public-read',
      }));
    },
    async putBytes(key, body, contentType) {
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType,
        ACL: 'public-read',
      }));
    },
    async head(key) {
      const r = await s3.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return { contentLength: r.ContentLength ?? 0 };
    },
    async getString(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return await r.Body!.transformToString();
    },
    async probeBytes(key, start, length) {
      const r = await s3.send(new GetObjectCommand({
        Bucket: cfg.bucket, Key: key, Range: `bytes=${start}-${start + length - 1}`,
      }));
      const arr = await r.Body!.transformToByteArray();
      return Buffer.from(arr);
    },
    async ensureBucket() {
      try {
        await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      } catch (e) {
        if (e instanceof BucketAlreadyOwnedByYou || e instanceof BucketAlreadyExists) return;
        throw e;
      }
    },
  };
}
