/**
 * Electron main entry point. Boots the same server as `index.ts`, then
 * opens a BrowserWindow pointed at it.
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { run } from './index.ts';

let shutdownFn: (() => Promise<void>) | null = null;

app.whenReady().then(async () => {
  try {
    const resources = process.resourcesPath;
    const booted = await run({
      dbcCsv: join(resources, 'NFR26DBC.csv'),
      migrationsDir: join(resources, 'migrations'),
      parserBinary: join(resources, 'parser', 'parser'),
      staticRoot: join(resources, 'app'),
    });
    shutdownFn = booted.shutdown;

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await win.loadURL(`http://${booted.host}:${booted.port}`);
  } catch (err) {
    console.error('Electron boot failed:', err);
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (shutdownFn) await shutdownFn();
  app.quit();
});
