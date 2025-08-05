const { contextBridge, ipcRenderer, dialog } = require('electron')

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
})

contextBridge.exposeInMainWorld('fileUpload', {
  openFile: () => ipcRenderer.invoke('dialog:openFile')
})

contextBridge.exposeInMainWorld('expandFunction', {
  openCsvWindow: (data) => ipcRenderer.invoke('open-csv-window', data),
  onCsvData: (callback) => ipcRenderer.on('csv-data', (_event, data) => callback(data))
})