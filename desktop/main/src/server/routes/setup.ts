import type { FastifyInstance } from 'fastify';

export interface SetupState {
  status: 'ok' | 'not_reachable';
  lastError: string | null;
  retry?: () => Promise<{ ok: boolean; error?: string }>;
}

export function registerSetupRoutes(app: FastifyInstance, state: SetupState) {
  app.get('/api/setup/status', async () => ({
    pg: state.status,
    lastError: state.lastError,
  }));

  app.post('/api/setup/retry', async (_req, reply) => {
    if (!state.retry) {
      reply.code(400);
      return { error: 'retry not available' };
    }
    const result = await state.retry();
    return result;
  });
}
