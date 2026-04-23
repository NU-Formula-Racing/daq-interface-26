import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import pg from 'pg';
import WebSocket from 'ws';
import { createScratchDb, type ScratchDb } from '../helpers/pg.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { buildApp } from '../../src/server/app.ts';
import type { ParserEvent } from '../../src/parser/protocol.ts';

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../migrations'
);

class FakeParser extends EventEmitter {
  emitEvent(e: ParserEvent) {
    this.emit('event', e);
  }
}

async function waitForMessage<T = unknown>(ws: WebSocket): Promise<T> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(String(data))));
  });
}

describe('WebSocket channels', () => {
  let db: ScratchDb | null = null;

  afterAll(async () => {
    if (db) await db.drop();
  });

  it('fans out frames events on /ws/live and meta events on /ws/events', async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    const pool = new pg.Pool({ connectionString: db.url, max: 3 });
    const parser = new FakeParser();

    const app = await buildApp({ pool, parser: parser as unknown as EventEmitter });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const actualPort =
      typeof address === 'object' && address ? address.port : 0;

    try {
      const live = new WebSocket(`ws://127.0.0.1:${actualPort}/ws/live`);
      const events = new WebSocket(`ws://127.0.0.1:${actualPort}/ws/events`);
      await Promise.all([
        new Promise((r) => live.once('open', r)),
        new Promise((r) => events.once('open', r)),
      ]);

      const liveMsgP = waitForMessage<{ type: string }>(live);
      const metaMsgP = waitForMessage<{ type: string }>(events);

      parser.emitEvent({
        type: 'frames',
        rows: [{ ts: '2026-04-22T12:00:00Z', signal_id: 1, value: 9.9 }],
      });
      parser.emitEvent({
        type: 'serial_status',
        state: 'connected',
        port: '/dev/ttyFAKE',
      });

      const [liveMsg, metaMsg] = await Promise.all([liveMsgP, metaMsgP]);
      expect(liveMsg.type).toBe('frames');
      expect(metaMsg.type).toBe('serial_status');

      live.close();
      events.close();
    } finally {
      await app.close();
      await pool.end();
    }
  }, 30_000);

  it('GET /api/live/status reflects latest serial + session state from parser events', async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    const pool = new pg.Pool({ connectionString: db.url, max: 3 });
    const parser = new FakeParser();
    const app = await buildApp({ pool, parser: parser as unknown as EventEmitter });

    try {
      parser.emitEvent({ type: 'serial_status', state: 'connected', port: '/dev/ttyFAKE' });
      parser.emitEvent({ type: 'session_started', session_id: 'abc', source: 'live' });

      const res = await app.inject({ method: 'GET', url: '/api/live/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        basestation: 'connected',
        session_id: 'abc',
        port: '/dev/ttyFAKE',
      });

      parser.emitEvent({ type: 'session_ended', session_id: 'abc', row_count: 5 });
      parser.emitEvent({ type: 'serial_status', state: 'disconnected' });

      const res2 = await app.inject({ method: 'GET', url: '/api/live/status' });
      expect(res2.json()).toMatchObject({
        basestation: 'disconnected',
        session_id: null,
      });
    } finally {
      await app.close();
      await pool.end();
    }
  });

  it('rejects /ws/live connections without a valid token when auth is enabled', async () => {
    db = await createScratchDb();
    await runMigrations(db.client, MIGRATIONS_DIR);
    const pool = new pg.Pool({ connectionString: db.url, max: 3 });
    const parser = new FakeParser();

    const app = await buildApp({
      pool,
      parser: parser as unknown as EventEmitter,
      authToken: 'wssecret',
    });
    try {
      // Test that auth hook protects /ws/live by verifying the onRequest hook
      // rejects requests without the token. Since app.inject doesn't truly
      // upgrade WebSockets, we test that the auth gate prevents the request.
      const resWithoutToken = await app.inject({
        method: 'GET',
        url: '/ws/live',
      });
      expect(resWithoutToken.statusCode).toBe(401);

      // With token via query param, the request is allowed past auth.
      const resWithToken = await app.inject({
        method: 'GET',
        url: '/ws/live?key=wssecret',
      });
      // Will get 400 since inject can't complete the WebSocket upgrade,
      // but the important part is auth allowed it (not 401).
      expect(resWithToken.statusCode).not.toBe(401);
    } finally {
      await app.close();
      await pool.end();
    }
  });
});
