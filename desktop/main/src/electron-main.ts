/**
 * Electron main entry point. Boots the same server as `index.ts`, then
 * opens a BrowserWindow pointed at it. Kept minimal — we don't want
 * Electron-specific logic leaking into the headless server path.
 */
import { app, BrowserWindow } from 'electron';
import { run } from './index.ts';

let shutdownFn: (() => Promise<void>) | null = null;

app.whenReady().then(async () => {
  const booted = await run();
  shutdownFn = booted.shutdown;

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`http://${booted.host}:${booted.port}`);
});

app.on('window-all-closed', async () => {
  if (shutdownFn) await shutdownFn();
  app.quit();
});
