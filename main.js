const { app, BrowserWindow, ipcMain, dialog } = require('electron/main')
const path = require("node:path")
const { handleFileOpen } = require('./utils/handleFileOpen')

const createWindow = () => {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    })

    win.loadFile(path.join(__dirname, "html", "index.html"))
}

app.whenReady().then(() => {
    ipcMain.handle('dialog:openFile', handleFileOpen)
    
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})