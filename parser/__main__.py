"""CLI entrypoint for the NFR 26 parser.

Usage (invoke via the explicit script path; the module is a flat-layout
package so `python -m parser` requires `PYTHONPATH=parser`):

  python parser/__main__.py live  --dbc <csv> --port <device> [--baud 9600]
  python parser/__main__.py batch --dbc <csv> --file <nfr>

The DB connection string is read from the `NFR_DB_URL` environment variable
(default: `postgres://postgres@localhost:5432/nfr_local`).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Make sibling modules (batch, live, protocol, ...) importable no matter
# which cwd Python is launched from. The parser directory contains the
# sibling modules with flat (non-package) imports.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from batch import run_batch_import  # noqa: E402
from live import run_live  # noqa: E402
from protocol import ProtocolEmitter  # noqa: E402
from serial_source import serial_events  # noqa: E402


DEFAULT_DSN = "postgres://postgres@localhost:5432/nfr_local"


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="parser")
    sub = p.add_subparsers(dest="mode", required=True)

    live = sub.add_parser("live", help="Read live frames from a serial port.")
    live.add_argument("--dbc", required=True, type=Path)
    live.add_argument("--port", required=True)
    live.add_argument("--baud", type=int, default=9600)

    batch = sub.add_parser("batch", help="Import a single .nfr log file.")
    batch.add_argument("--dbc", required=True, type=Path)
    batch.add_argument("--file", required=True, type=Path)

    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    dsn = os.environ.get("NFR_DB_URL", DEFAULT_DSN)
    emitter = ProtocolEmitter(sys.stdout)

    try:
        if args.mode == "live":
            run_live(
                dsn=dsn,
                dbc_csv=args.dbc,
                source=serial_events(args.port, args.baud),
                emitter=emitter,
            )
            return 0
        if args.mode == "batch":
            run_batch_import(
                dsn=dsn, dbc_csv=args.dbc, nfr_file=args.file, emitter=emitter
            )
            return 0
    except Exception as err:  # noqa: BLE001
        emitter.error(str(err))
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
