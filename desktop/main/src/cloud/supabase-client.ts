// Thin wrapper around supabase-js that installs the WebSocket polyfill the
// library needs at module load. Electron bundles Node 20+, which has no
// global WebSocket; supabase-js v2 throws at realtime init even when REST is
// the only thing we call. Importing this module once before any createClient
// call is enough.
import WebSocket from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

export { createClient };
export type { SupabaseClient };
