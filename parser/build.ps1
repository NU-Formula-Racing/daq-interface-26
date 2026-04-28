# Build a single-file parser.exe for Windows.
# Output: parser/dist/parser/parser.exe
# Same output dir name as build.sh so electron-builder's extraResources entry
# can be a single platform-agnostic path.
$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

$outDir = "dist/parser"

if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
if (Test-Path "parser.spec") { Remove-Item -Force "parser.spec" }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$pyinstaller = ".\.venv\Scripts\pyinstaller.exe"
if (-not (Test-Path $pyinstaller)) {
  $pyinstaller = "pyinstaller"
}

& $pyinstaller `
  --onefile `
  --name parser `
  --hidden-import psycopg_binary `
  --hidden-import serial `
  --hidden-import serial.tools.list_ports `
  --distpath $outDir `
  __main__.py

Write-Host ""
Write-Host "Built: $outDir\parser.exe"
& "$outDir\parser.exe" --help | Select-Object -First 20
