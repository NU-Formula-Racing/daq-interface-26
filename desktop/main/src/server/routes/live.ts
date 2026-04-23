import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'events';
import type { ParserEvent } from '../../parser/protocol.ts';

export interface LiveStatus {
  basestation: 'connected' | 'disconnected';
  port: string | null;
  session_id: string | null;
  source: 'live' | 'sd_import' | null;
}

export function registerLiveRoutes(app: FastifyInstance, parser: EventEmitter) {
  const state: LiveStatus = {
    basestation: 'disconnected',
    port: null,
    session_id: null,
    source: null,
  };

  parser.on('event', (e: ParserEvent) => {
    if (e.type === 'serial_status') {
      state.basestation = e.state;
      state.port = e.port ?? null;
    } else if (e.type === 'session_started') {
      state.session_id = e.session_id;
      state.source = e.source;
    } else if (e.type === 'session_ended') {
      state.session_id = null;
      state.source = null;
    }
  });

  app.get('/api/live/status', async () => state);
}
