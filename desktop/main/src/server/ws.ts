import type { FastifyInstance } from 'fastify';
import type { EventEmitter } from 'events';
import type { ParserEvent } from '../parser/protocol.ts';

type LiveSocket = { send: (data: string) => void; readyState: number };

export function registerWebSockets(
  app: FastifyInstance,
  parser: EventEmitter
): void {
  const liveClients = new Set<LiveSocket>();
  const eventClients = new Set<LiveSocket>();

  parser.on('event', (e: ParserEvent) => {
    const encoded = JSON.stringify(e);
    const target = e.type === 'frames' ? liveClients : eventClients;
    for (const sock of target) {
      if (sock.readyState === 1 /* OPEN */) {
        sock.send(encoded);
      }
    }
  });

  app.register(async (inner) => {
    inner.get('/ws/live', { websocket: true }, (socket) => {
      liveClients.add(socket as unknown as LiveSocket);
      socket.on('close', () => liveClients.delete(socket as unknown as LiveSocket));
    });

    inner.get('/ws/events', { websocket: true }, (socket) => {
      eventClients.add(socket as unknown as LiveSocket);
      socket.on('close', () => eventClients.delete(socket as unknown as LiveSocket));
    });
  });
}
