import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { readFile, writeFile } from 'fs/promises';
import { setAppConfig } from '../../db/config.ts';

export interface DbcUploadDeps {
  pool: pg.Pool;
  /** Where uploaded DBC CSVs are written. */
  storePath: string;
  /** Called after the DBC is saved + config updated; restarts the parser. */
  onDbcChanged: () => Promise<void>;
}

export function registerDbcRoutes(app: FastifyInstance, deps: DbcUploadDeps) {
  app.post('/api/dbc/upload', async (req, reply) => {
    let body = '';
    if (typeof req.body === 'string') {
      body = req.body;
    } else if (req.body && typeof req.body === 'object' && 'csv' in (req.body as any)) {
      body = String((req.body as any).csv);
    } else {
      reply.code(400);
      return { error: 'expected CSV body (text/csv or {"csv": "..."} JSON)' };
    }

    const trimmed = body.trim();
    if (trimmed.length === 0) {
      reply.code(400);
      return { error: 'empty CSV' };
    }
    const firstLine = trimmed.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
    if (!firstLine.includes('message id') || !firstLine.includes('signal name')) {
      reply.code(400);
      return { error: 'CSV header must include "Message ID" and "Signal Name" columns' };
    }

    await writeFile(deps.storePath, trimmed + '\n', 'utf-8');
    await setAppConfig(deps.pool, { dbcPath: deps.storePath });

    try {
      await deps.onDbcChanged();
    } catch (err) {
      reply.code(500);
      return { error: 'saved DBC but failed to restart parser', detail: String(err) };
    }

    return { ok: true, path: deps.storePath };
  });

  app.get('/api/dbc/status', async () => {
    const { rows } = await deps.pool.query<{ data: any }>(
      'SELECT data FROM app_config WHERE id = 1',
    );
    return {
      active: typeof rows[0]?.data?.dbcPath === 'string' ? rows[0].data.dbcPath : null,
    };
  });

  app.get('/api/dbc/current', async (_req, reply) => {
    const { rows } = await deps.pool.query<{ data: any }>(
      'SELECT data FROM app_config WHERE id = 1',
    );
    const path =
      typeof rows[0]?.data?.dbcPath === 'string' && rows[0].data.dbcPath.length > 0
        ? rows[0].data.dbcPath
        : deps.storePath;
    let csv: string;
    try {
      csv = await readFile(path, 'utf-8');
    } catch (err) {
      reply.code(404);
      return { error: `DBC file not found at ${path}`, detail: String(err) };
    }
    return { path, rows: parseDbcCsv(csv) };
  });
}

export interface DbcRow {
  frame_id: string;
  message_name: string;
  sender: string;
  signal_name: string;
  start_bit: number | null;
  size_bits: number | null;
  factor: number | null;
  offset: number | null;
  min: number | null;
  max: number | null;
  unit: string;
  cycle_ms: number | null;
  data_type: string;
}

function parseDbcCsv(csv: string): DbcRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const out: DbcRow[] = [];
  // Carry forward "message"-level columns when a row has an empty Message ID
  // (DBC CSV convention: blank means "same message as the row above").
  let lastFrame = '';
  let lastMsgName = '';
  let lastSender = '';
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length === 0) continue;
    const frame = cells[0]?.trim() || lastFrame;
    const msg = cells[1]?.trim() || lastMsgName;
    const sender = cells[2]?.trim() || lastSender;
    lastFrame = frame; lastMsgName = msg; lastSender = sender;
    out.push({
      frame_id: frame,
      message_name: msg,
      sender,
      signal_name: cells[3]?.trim() ?? '',
      start_bit: numOrNull(cells[4]),
      size_bits: numOrNull(cells[5]),
      factor: numOrNull(cells[6]),
      offset: numOrNull(cells[7]),
      min: numOrNull(cells[8]),
      max: numOrNull(cells[9]),
      unit: cells[10]?.trim() ?? '',
      cycle_ms: numOrNull(cells[11]),
      data_type: cells[12]?.trim() ?? '',
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV split: handles double-quoted fields with embedded commas.
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') { inQ = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

function numOrNull(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
