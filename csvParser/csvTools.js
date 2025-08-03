const { parse } = require('csv-parse/sync')

function processCsv(filePath, fileContent) {
  if (!filePath.endsWith('.csv')) {
    return { error: 'Please select a .csv file.' }
  }

  if (fileContent.trim().length === 0) {
    return { error: 'CSV file is empty.' }
  }

  const lines = fileContent.trim().split('\n')
  const headerLength = lines[0].split(',').length

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    const columns = lines[i].split(',')
    if (columns.length !== headerLength) {
      return {
        error: `Row ${i + 1} has ${columns.length} columns. Expected ${headerLength}.`
      }
    }
  }

  const data = parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  })

  return { data }
}

module.exports = { processCsv }