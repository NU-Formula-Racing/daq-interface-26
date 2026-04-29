# parser

The Python program that reads CAN data off the car (or out of saved files) and writes it into Postgres.

## What it does

1. Loads a DBC-style CSV (`NFR26DBC.csv`) that describes every CAN message on the bus and the signals packed into each frame.
2. Compiles the CSV into an in-memory decode table at startup.
3. Reads frames from a source: a USB-serial port (live mode), a `.nfr` log file (batch mode), or a `.nfr` file replayed at chosen speed (replay mode).
4. Decodes each frame into named signal values and inserts them into Postgres.

## Modes

The parser is invoked by the desktop app as a subprocess with one of three subcommands:

- `live --dbc <csv> --port <serial>` — read frames from a serial port at 500 Hz, decode, and write to Postgres in real time. Also emits one JSON line per frame on stdout so the desktop app can stream them to the browser over a WebSocket.
- `batch --dbc <csv> --file <nfr>` — read a binary `.nfr` log from the SD card on the car, decode every frame, and insert as one session you can scrub through later.
- `replay --dbc <csv> --file <nfr> --speed <x>` — same as batch but paced at real time (or `<x>` times faster) so the live UI animates while ingesting.

## Files

- `__main__.py` — CLI entry point (parses subcommand and dispatches)
- `compile.py` — turns the CSV into a decode table
- `signalSpec.py` — small data classes for SignalSpec / MessageSpec
- `decode.py` — runtime bit slicing + scale/offset application
- `nfr_reader.py` / `protocol.py` — read the binary `.nfr` log format
- `serial_source.py` / `file_source.py` — abstractions over the input
- `db.py` — Postgres writer (uses `psycopg`)
- `live.py` / `batch.py` — wire the pieces together for each mode
- `build.sh` / `build.ps1` — produce a single-file binary via PyInstaller

## Local development

```
python -m venv .venv
source .venv/bin/activate           # Windows: .\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
pytest                              # run the test suite
```

To run against a Postgres you have locally:

```
NFR_DB_URL=postgres://postgres@localhost:5432/nfr_local \
python -m . live --dbc ../NFR26DBC.csv --port /dev/tty.usbserial-XXXX
```

## Building a single-file binary

```
./build.sh        # macOS or Linux
.\build.ps1       # Windows
```

Output: `dist/parser/parser` (or `parser.exe`). The desktop app picks this up automatically when it packages.

## Notes

- Decoding is stateless: same input frame always produces the same output. Anything observable (DB writes, stdout) lives outside the decode functions so the bit math stays easy to test.
- Bit positions in the CSV are absolute and big-endian, so endianness conversion is not a runtime concern.
- All structural validation (overlapping signals, bad bit ranges) happens once at compile time; the runtime path is straight bit slicing and scale/offset arithmetic.
