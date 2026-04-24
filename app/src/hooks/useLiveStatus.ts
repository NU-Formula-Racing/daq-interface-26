import { useEffect, useState } from 'react';
import { subscribeEvents } from '../api/ws.ts';
import { apiGet } from '../api/client.ts';
import type { LiveStatus, ParserEvent } from '../api/types.ts';

const INITIAL: LiveStatus = {
  basestation: 'disconnected',
  port: null,
  session_id: null,
  source: null,
};

export function useLiveStatus(): LiveStatus {
  const [state, setState] = useState<LiveStatus>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    apiGet<LiveStatus>('/api/live/status')
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {});
    const sub = subscribeEvents((ev: ParserEvent) => {
      setState((prev) => {
        if (ev.type === 'serial_status') {
          return { ...prev, basestation: ev.state, port: ev.port ?? null };
        }
        if (ev.type === 'session_started') {
          return { ...prev, session_id: ev.session_id, source: ev.source };
        }
        if (ev.type === 'session_ended') {
          return { ...prev, session_id: null, source: null };
        }
        return prev;
      });
    });
    return () => {
      cancelled = true;
      sub.close();
    };
  }, []);

  return state;
}
