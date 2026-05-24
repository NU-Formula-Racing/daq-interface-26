import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import os from 'node:os';
import { makeSpaces } from '../../cloud/spaces.ts';
import { uploadSession, AlreadySyncedError } from '../../cloud/upload.ts';
import { getAppConfig } from '../../db/config.ts';

export function registerCloudUploadRoutes(app: FastifyInstance, pool: pg.Pool, pgConnStr: string) {
  app.post<{ Params: { id: string } }>('/api/cloud/upload/:id', async (req, reply) => {
    const cfg = await getAppConfig(pool);
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return reply.code(400).send({ error: 'supabase not configured' });
    if (!cfg.spacesEndpoint || !cfg.spacesBucket || !cfg.spacesAccessKey || !cfg.spacesSecretKey) {
      return reply.code(400).send({ error: 'spaces not configured' });
    }
    const sb = createClient(cfg.supabaseUrl as string, cfg.supabaseAnonKey as string);
    const spaces = makeSpaces({
      endpoint: cfg.spacesEndpoint as string, region: (cfg.spacesRegion as string | null | undefined) ?? 'us-east-1',
      bucket: cfg.spacesBucket as string, accessKey: cfg.spacesAccessKey as string, secretKey: cfg.spacesSecretKey as string,
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
