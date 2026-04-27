/**
 * Minimal preload. Exposes the base URL so the renderer can talk to the
 * local server without hardcoding a port. Broadcast-mode token (if any)
 * is fetched by the renderer via /api/config.
 *
 * Also exposes a small bridge for native dialogs that the renderer needs
 * (folder picker for the storage-setup flow, userData path resolution).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__nfr__', {
  baseUrl: window.location.origin,
  pickFolder: (): Promise<{ canceled: boolean; path: string | null }> =>
    ipcRenderer.invoke('pick-folder'),
  userDataPath: (): Promise<string> => ipcRenderer.invoke('user-data-path'),
});
