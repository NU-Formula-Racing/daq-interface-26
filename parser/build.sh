#!/usr/bin/env bash
# Build a single-file parser binary for the current platform.
# Output: parser/dist/parser/parser  (or parser.exe on Windows when run via Git Bash)
# The output directory is always the same so electron-builder's extraResources
# entry can be a single platform-agnostic path. Each CI runner produces its own.
set -euo pipefail

cd "$(dirname "$0")"

OUT_DIR="dist/parser"

rm -rf "$OUT_DIR" "build" "parser.spec"
mkdir -p "$OUT_DIR"

if [ -x ".venv/bin/pyinstaller" ]; then
  PYINSTALLER=".venv/bin/pyinstaller"
elif [ -x ".venv/Scripts/pyinstaller.exe" ]; then
  PYINSTALLER=".venv/Scripts/pyinstaller.exe"
else
  PYINSTALLER="pyinstaller"
fi

"$PYINSTALLER" \
  --onefile \
  --name parser \
  --hidden-import psycopg_binary \
  --hidden-import serial \
  --hidden-import serial.tools.list_ports \
  --distpath "$OUT_DIR" \
  __main__.py

echo ""
if [ -f "$OUT_DIR/parser.exe" ]; then
  echo "Built: $OUT_DIR/parser.exe"
  "$OUT_DIR/parser.exe" --help | head -20
else
  echo "Built: $OUT_DIR/parser"
  "$OUT_DIR/parser" --help | head -20
fi
