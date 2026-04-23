import type { ParserEvent } from './types.ts';

function tokenFor(url: URL): void {
  const token = new URLSearchParams(window.location.search).get('key')
    ?? localStorage.getItem('nfr_api_token');
  if (token) url.searchParams.set('key', token);
}

function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${proto}//${window.location.host}${path}`);
  tokenFor(url);
  return url.toString();
}

export interface WsSubscription {
  close: () => void;
}

export function subscribeLive(onEvent: (ev: ParserEvent) => void): WsSubscription {
  return openWs('/ws/live', onEvent);
}

export function subscribeEvents(onEvent: (ev: ParserEvent) => void): WsSubscription {
  return openWs('/ws/events', onEvent);
}

function openWs(path: string, onEvent: (ev: ParserEvent) => void): WsSubscription {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl(path));
    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(String(msg.data)));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      reconnectTimer = setTimeout(connect, 1000);
    };
    ws.onerror = () => {
      // onclose will fire and trigger reconnect.
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
