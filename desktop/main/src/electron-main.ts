/**
 * Electron main entry point. Boots the same server as `index.ts`, then
 * opens a BrowserWindow pointed at it.
 *
 * The orchestrator (run()) calls process.exit(0) when it wants to be
 * relaunched (e.g. after switching active database). We use app.relaunch()
 * + app.exit(0) when that happens so Electron spawns a fresh instance of
 * the entire app — that's the simplest way to get a clean orchestrator
 * boot without re-architecting the IPC setup.
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'path';
import { run } from './index.ts';

let shutdownFn: (() => Promise<void>) | null = null;
let mainWindow: BrowserWindow | null = null;
let isRelaunching = false;

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  return {
    canceled: res.canceled,
    path: res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0],
  };
});

ipcMain.handle('user-data-path', () => app.getPath('userData'));

// Override process.exit so the orchestrator's "exit to restart" pattern
// triggers an Electron relaunch instead of killing the whole app. Anything
// that goes through process.exit(0) — including the catalog routes'
// signalRestart() and the setup retry — will land here.
const originalExit = process.exit.bind(process);
process.exit = ((code?: number) => {
  if (code === 0 && !isRelaunching && app.isReady()) {
    isRelaunching = true;
    void (async () => {
      try {
        if (shutdownFn) await shutdownFn();
      } catch (err) {
        console.error('shutdown during relaunch failed:', err);
      }
      app.relaunch();
      app.exit(0);
    })();
    return undefined as never;
  }
  return originalExit(code as number);
}) as typeof process.exit;

app.whenReady().then(async () => {
  try {
    const resources = process.resourcesPath;
    const booted = await run({
      dbcCsv: join(resources, 'NFR26DBC.csv'),
      migrationsDir: join(resources, 'migrations'),
      parserBinary: join(resources, 'parser', process.platform === 'win32' ? 'parser.exe' : 'parser'),
      staticRoot: join(resources, 'app'),
      userDataDir: app.getPath('userData'),
    });
    shutdownFn = booted.shutdown;

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, 'preload.cjs'),
      },
    });
    await mainWindow.loadURL(`http://${booted.host}:${booted.port}`);
  } catch (err) {
    console.error('Electron boot failed:', err);
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (isRelaunching) return; // relaunch flow handles its own shutdown
  if (shutdownFn) await shutdownFn();
  app.quit();
});
