export type ParserEvent =
  | { type: 'serial_status'; state: 'connected' | 'disconnected'; port?: string }
  | { type: 'session_started'; session_id: string; source: 'live' | 'sd_import' }
  | { type: 'session_ended'; session_id: string; row_count: number }
  | { type: 'frames'; rows: Array<{ ts: string; signal_id: number; value: number }> }
  | { type: 'import_progress'; file: string; pct: number }
  | { type: 'error'; msg: string };

/** Parse one line from the parser subprocess. Returns null on malformed input. */
export function parseLine(line: string): ParserEvent | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') {
      return obj as ParserEvent;
    }
  } catch {
    /* fall through */
  }
  return null;
}
