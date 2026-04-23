/**
 * Minimal preload. Exposes the base URL so the renderer can talk to the
 * local server without hardcoding a port. Broadcast-mode token (if any)
 * is fetched by the renderer via /api/config.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('__nfr__', {
  baseUrl: window.location.origin,
});
