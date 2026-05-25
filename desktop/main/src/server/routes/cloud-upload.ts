import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '../../cloud/supabase-client.ts';
import os from 'node:os';
import { makeSpaces } from '../../cloud/spaces.ts';
import { uploadSession, AlreadySyncedError } from '../../cloud/upload.ts';
import type { CloudDefaults } from '../../cloud/defaults.ts';
import { getEffectiveCloudConfig } from '../../cloud/effective-config.ts';

export function registerCloudUploadRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  pgConnStr: string,
  cloudDefaults: CloudDefaults,
) {
  app.post<{ Params: { id: string } }>('/api/cloud/upload/:id', async (req, reply) => {
    const eff = await getEffectiveCloudConfig(pool, cloudDefaults);
    if (!eff.supabaseUrl || !eff.supabaseAnonKey) {
      return reply.code(400).send({ error: 'supabase not configured' });
    }
    if (!eff.spacesWriteReady) {
      return reply.code(400).send({
        error: 'spaces write credentials not configured (endpoint, region, bucket, access key, secret key)',
      });
    }
    const sb = createClient(eff.supabaseUrl, eff.supabaseAnonKey);
    const spaces = makeSpaces({
      endpoint: eff.spacesEndpoint!,
      region: eff.spacesRegion!,
      bucket: eff.spacesBucket!,
      accessKey: eff.spacesAccessKey!,
      secretKey: eff.spacesSecretKey!,
    });
    try {
      const r = await uploadSession({
        sessionId: req.params.id, pool, sb, spaces,
        machine: os.hostname(), pgConnStr,
      });
      return reply.send({ status: 'ok', ...r });
    } catch (e) {
      if (e instanceof AlreadySyncedError) {
        return reply.code(409).send({ status: 'already_synced', existing: e.existing });
      }
      req.log.error({ err: e }, 'cloud upload failed');
      return reply.code(500).send({ error: (e as Error).message });
    }
  });
}
