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

export function makeSpaces(cfg: SpacesConfig): SpacesClient {
  const s3 = new S3Client({
    endpoint: cfg.endpoint,
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
      }));
    },
    async putBytes(key, body, contentType) {
      await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType,
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
