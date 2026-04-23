export interface Session {
  id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  track: string | null;
  driver: string | null;
  car: string | null;
  notes: string | null;
  source: 'live' | 'sd_import';
  source_file: string | null;
  synced_at: string | null;
}

export interface SessionDetail extends Session {
  signals: Array<{
    signal_id: number;
    source: string;
    signal_name: string;
    unit: string | null;
  }>;
}

export interface OverviewRow {
  bucket: string;
  signal_id: number;
  avg_value: number;
}

export interface WindowRow {
  ts: string;
  value: number;
}

export interface SignalDefinition {
  id: number;
  source: string;
  signal_name: string;
  unit: string | null;
  description: string | null;
}

export interface LiveStatus {
  basestation: 'connected' | 'disconnected';
  port: string | null;
  session_id: string | null;
  source: 'live' | 'sd_import' | null;
}

export type ParserEvent =
  | { type: 'serial_status'; state: 'connected' | 'disconnected'; port?: string }
  | { type: 'session_started'; session_id: string; source: 'live' | 'sd_import' }
  | { type: 'session_ended'; session_id: string; row_count: number }
  | { type: 'frames'; rows: Array<{ ts: string; signal_id: number; value: number }> }
  | { type: 'import_progress'; file: string; pct: number }
  | { type: 'error'; msg: string };
