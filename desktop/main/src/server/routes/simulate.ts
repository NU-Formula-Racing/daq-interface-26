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
    // Catalog min/max comes from the DBC and lives on the client; sending
    // it with the start request avoids a fragile DB schema dependency
    // (signal_definitions has no min/max columns) and keeps the simulator
    // honest about each signal's expected range.
    const body = (req.body ?? {}) as {
      signals?: Array<{ id: number; name?: string; min: number; max: number }>;
    };
    const reqSigs = (body.signals ?? []).filter(
      (s) =>
        s != null &&
        typeof s.id === 'number' && Number.isFinite(s.id) &&
        typeof s.min === 'number' && Number.isFinite(s.min) &&
        typeof s.max === 'number' && Number.isFinite(s.max) &&
        s.max > s.min,
    );
    if (reqSigs.length === 0) {
      reply.code(400);
      return { error: 'expected signals: [{id, name?, min, max}, …] with max > min' };
    }
    state.defs = new Map();
    for (const s of reqSigs) {
      state.defs.set(s.id, { min: s.min, max: s.max, signal_name: s.name ?? `signal_${s.id}` });
    }
    state.signalIds = reqSigs.map((s) => s.id);
    state.startMs = Date.now();
    state.timer = setInterval(() => { void tick(deps); }, TICK_MS);
    return { running: true, signalIds: state.signalIds };
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
