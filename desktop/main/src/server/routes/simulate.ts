import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'events';
import type pg from 'pg';

/**
 * Synthetic live-frame generator. Injects fake `frames` events directly into
 * the parser EventEmitter so the WS fan-out picks them up exactly the same
 * way real parser frames do — the dock can't tell the difference. Also
 * writes the same rows into `live_today` so anything queried via
 * /api/live/window stays consistent with what's on the dock.
 *
 * Generates a per-signal sine wave between the signal's min/max from
 * `signal_definitions`. Each signal gets a different frequency + phase
 * so the dock visibly varies signal-to-signal.
 */

interface SimSignalDef {
  min: number;
  max: number;
  signal_name: string;
}

interface SimState {
  timer: NodeJS.Timeout | null;
  signalIds: number[];
  defs: Map<number, SimSignalDef>;
  startMs: number;
}

const state: SimState = {
  timer: null,
  signalIds: [],
  defs: new Map(),
  startMs: 0,
};

// 10 Hz across all signals.
const TICK_MS = 100;

export interface SimulateDeps {
  parser: EventEmitter;
  pool: pg.Pool;
}

export function registerSimulateRoutes(app: FastifyInstance, deps: SimulateDeps) {
  app.get('/api/live/simulate/status', async () => ({
    running: state.timer !== null,
    signalIds: state.signalIds,
  }));

  app.post('/api/live/simulate/start', async (req, reply) => {
    if (state.timer) {
      return { running: true, signalIds: state.signalIds, message: 'already running' };
    }
    const body = (req.body ?? {}) as { signalIds?: number[] };
    const ids = (body.signalIds ?? []).filter((n) => typeof n === 'number' && Number.isFinite(n));
    if (ids.length === 0) {
      reply.code(400);
      return { error: 'expected non-empty signalIds[] in body' };
    }
    // Load min/max for each requested signal so the wave fits the catalog
    // range. Falls back to [0, 1] if the catalog doesn't carry one.
    const { rows } = await deps.pool.query<{
      id: number; signal_name: string;
      min_value: number | null; max_value: number | null;
    }>(
      `SELECT id, signal_name, min_value, max_value
       FROM signal_definitions WHERE id = ANY($1::int[])`,
      [ids],
    );
    state.defs = new Map();
    for (const r of rows) {
      const min = r.min_value ?? 0;
      const max = r.max_value ?? (min === 0 ? 1 : min * 1.5);
      state.defs.set(r.id, { min, max, signal_name: r.signal_name });
    }
    state.signalIds = ids;
    state.startMs = Date.now();
    state.timer = setInterval(() => { void tick(deps); }, TICK_MS);
    return { running: true, signalIds: ids };
  });

  app.post('/api/live/simulate/stop', async () => {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    state.signalIds = [];
    state.defs.clear();
    return { running: false };
  });
}

async function tick(deps: SimulateDeps): Promise<void> {
  const elapsedSec = (Date.now() - state.startMs) / 1000;
  const ts = new Date().toISOString();
  const rows: Array<{ ts: string; signal_id: number; value: number }> = [];
  let i = 0;
  for (const id of state.signalIds) {
    const def = state.defs.get(id);
    if (!def) { i++; continue; }
    const mid = (def.max + def.min) / 2;
    const amp = (def.max - def.min) / 2;
    // Each signal gets its own period so they don't all peak together.
    const freq = 0.15 + (i % 7) * 0.07;   // Hz
    const phase = (i % 11) * 0.45;         // rad
    const value = mid + amp * Math.sin(2 * Math.PI * freq * elapsedSec + phase);
    rows.push({ ts, signal_id: id, value });
    i++;
  }
  if (rows.length === 0) return;

  // Fan out via the parser EventEmitter — same path the real parser uses.
  deps.parser.emit('event', { type: 'frames', rows });

  // Persist so /api/live/window stays consistent. Best-effort.
  try {
    const params: unknown[] = [];
    const placeholders: string[] = [];
    rows.forEach((r, idx) => {
      const base = idx * 3;
      placeholders.push(`($${base + 1}::timestamptz, $${base + 2}::int, $${base + 3}::double precision)`);
      params.push(r.ts, r.signal_id, r.value);
    });
    await deps.pool.query(
      `INSERT INTO live_today (ts, signal_id, value) VALUES ${placeholders.join(',')}`,
      params,
    );
  } catch (err) {
    console.error('simulate: live_today insert failed:', (err as Error).message);
  }
}
