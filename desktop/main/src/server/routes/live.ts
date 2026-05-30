import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'events';
import type { ParserEvent } from '../../parser/protocol.ts';

export interface LiveStatus {
  basestation: 'connected' | 'disconnected';
  port: string | null;
  session_id: string | null;
  source: 'live' | 'sd_import' | null;
  /** Most recent LoRa-link metrics, refreshed on every USB packet so a
   *  page that mounts mid-stream sees the current link health without
   *  waiting for the next packet to arrive over WS. */
  rssi: number | null;
  snr: number | null;
}

export function registerLiveRoutes(app: FastifyInstance, parser: EventEmitter) {
  const state: LiveStatus = {
    basestation: 'disconnected',
    port: null,
    session_id: null,
    source: null,
    rssi: null,
    snr: null,
  };

  parser.on('event', (e: ParserEvent) => {
    if (e.type === 'serial_status') {
      state.basestation = e.state;
      state.port = e.port ?? null;
      if (e.state === 'disconnected') {
        // Link metrics are stale once the basestation drops; clearing
        // them prevents a freshly-mounted page from showing the old
        // values as if the link were still alive.
        state.rssi = null;
        state.snr = null;
      }
    } else if (e.type === 'session_started') {
      state.session_id = e.session_id;
      state.source = e.source;
    } else if (e.type === 'session_ended') {
      state.session_id = null;
      state.source = null;
    } else if (e.type === 'signal_quality') {
      state.rssi = e.rssi;
      state.snr = e.snr;
    }
  });

  app.get('/api/live/status', async () => state);
}
