import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { networkInterfaces } from 'os';
import { randomBytes } from 'crypto';
import { getAppConfig, setAppConfig } from '../../db/config.ts';

export interface BroadcastDeps {
  configPool: pg.Pool;
  signalRestart: () => void;
  port: number;
  host: string;
}

function lanIpv4Addresses(): string[] {
  const ifaces = networkInterfaces();
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const entry of list) {
      // Node's NodeJS.NetworkInterfaceInfo: family is 'IPv4' (Node 18+) or 4 (older).
      const fam = (entry as { family: string | number }).family;
      const isV4 = fam === 'IPv4' || fam === 4;
      if (isV4 && !entry.internal) {
        out.push(entry.address);
      }
    }
  }
  return out;
}

function buildLanUrls(port: number, token: string | null): string[] {
  const ips = lanIpv4Addresses();
  const tokenSuffix = token ? `?key=${encodeURIComponent(token)}` : '';
  return ips.map((ip) => `http://${ip}:${port}${tokenSuffix}`);
}

function genToken(): string {
  return randomBytes(24).toString('hex');
}

export function registerBroadcastRoutes(
  app: FastifyInstance,
  deps: BroadcastDeps,
): void {
  app.get('/api/broadcast', async () => {
    const cfg = await getAppConfig(deps.configPool);
    const enabled = cfg.broadcastEnabled === true;
    const token = typeof cfg.authToken === 'string' ? cfg.authToken : null;
    const lanUrls = enabled ? buildLanUrls(deps.port, token) : buildLanUrls(deps.port, null);
    return {
      enabled,
      token: enabled ? token : null,
      host: deps.host,
      port: deps.port,
      lanUrls,
    };
  });

  app.post<{ Body: { enabled: boolean } }>(
    '/api/broadcast/toggle',
    async (req, reply) => {
      if (typeof req.body?.enabled !== 'boolean') {
        reply.code(400);
        return { error: 'enabled (boolean) required' };
      }
      const enabled = req.body.enabled;
      const patch: Record<string, unknown> = { broadcastEnabled: enabled };
      if (enabled) {
        // Regenerate the token whenever broadcast is freshly enabled.
        patch.authToken = genToken();
      }
      await setAppConfig(deps.configPool, patch);
      deps.signalRestart();
      return { ok: true, restarting: true };
    },
  );

  app.post('/api/broadcast/regenerate-token', async () => {
    await setAppConfig(deps.configPool, { authToken: genToken() });
    deps.signalRestart();
    return { ok: true, restarting: true };
  });
}
