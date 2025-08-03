const fs = require('fs')
const path = require('path')
const os = require('os')
const { dialog } = require('electron')
const { processCsv } = require("../../csvParser/CsvTools")

async function handleFileOpen() {
    const result = await dialog.showOpenDialog({
      title: 'Select a CSV file',
      defaultPath: path.join(os.homedir(), 'Downloads'),
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
      properties: ['openFile']
    })
  
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
  
    const filePath = result.filePaths[0]
    const fileContent = fs.readFileSync(filePath, 'utf-8')
  
    const resultObj = processCsv(filePath, fileContent)
    if (resultObj.error) return { error: resultObj.error }
  
    return {
      name: path.basename(filePath),
      data: resultObj.data
    }
  }
  
  module.exports = { handleFileOpen }