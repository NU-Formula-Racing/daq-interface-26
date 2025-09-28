const { app, BrowserWindow, ipcMain, dialog } = require('electron/main')
const path = require("node:path")
const { handleFileOpen } = require('./utils/handleFileOpen')

const createWindow = () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.loadFile(path.join(__dirname, '../renderer/dist/index.html'))
}

app.whenReady().then(() => {
    ipcMain.handle('dialog:openFile', handleFileOpen)

    ipcMain.handle('open-csv-window', async (_event, csvData) => {
        const newWin = new BrowserWindow({
            width: 900,
            height: 600,
            minWidth: 800,
            minHeight: 600,
            webPreferences: {
              preload: path.join(__dirname, 'preload.js'),
              contextIsolation: true,
              nodeIntegration: false,
            }
          });
          newWin.loadFile(path.join(__dirname, '../renderer/dist/table.html'));

          newWin.webContents.once('did-finish-load', () => {
            newWin.webContents.send('csv-data', csvData);
        });
    })
    
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

