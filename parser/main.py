import sys
import os
import re
import csv
import struct
from datetime import datetime, timezone, timedelta
from compile import compile_csv
from decode import decode_frame

HEADER_SIZE = 20
FRAME_SIZE = 18  # 4 timestamp + 4 id + 2 length + 8 data


def parse_header(header):
    # LogHeader: 9 byte version + 4 byte RtcDate + 7 byte RtcTime = 20 bytes
    # RtcDate (4 bytes): weekday, month, day, year (year is last 2 digits, 2000-2099)
    # RtcTime (7 bytes): hours, minutes, seconds, subseconds (uint32 ms)
    _weekday, month, day, year = struct.unpack_from("<BBBB", header, 9)
    hours, minutes, seconds, subseconds = struct.unpack_from("<BBBI", header, 13)
    date_str = f"20{year:02d}-{month:02d}-{day:02d}"
    time_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}.{subseconds:03d}"
    start_dt = datetime(2000 + year, month, day, hours, minutes, seconds,
                        subseconds * 1000, tzinfo=timezone.utc)
    return date_str, time_str, start_dt


def extract_session_id(nfr_path):
    # Extract the number from the filename, e.g. LOG_0041.NFR -> 41
    basename = os.path.basename(nfr_path)
    match = re.search(r"(\d+)", basename)
    if match:
        return int(match.group(1))
    return 0


def read_frames_from_file(file_path):
    # Generator that yields (timestamp_ms, frame_id, data) from a .nfr log file.
    # LogHeader: 9 byte version + 4 byte RtcDate + 7 byte RtcTime = 20 bytes
    # LogFrame: 4 byte timestamp (uint32 ms) + 4 byte id (uint32) + 2 byte dlc (uint16) + 8 byte data = 18 bytes
    # All little endian.

    with open(file_path, "rb") as f:
        header = f.read(HEADER_SIZE)
        if len(header) < HEADER_SIZE:
            return

        while True:
            frame = f.read(FRAME_SIZE)
            if len(frame) < FRAME_SIZE:
                return

            timestamp, frame_id, dlc = struct.unpack_from("<IIH", frame, 0)
            data = frame[10 : 10 + dlc]
            yield timestamp, frame_id, data


def main():
    # Parse --db flag
    args = [a for a in sys.argv[1:] if a != "--db"]
    upload_to_db = "--db" in sys.argv

    if len(args) < 2:
        print("Usage: python main.py <dbc_csv_path> <nfr_file_path> [--db]")
        sys.exit(1)

    csv_path = args[0]
    nfr_path = args[1]

    # Set up Supabase client if uploading
    supabase = None
    if upload_to_db:
        from dotenv import load_dotenv
        from supabase import create_client
        load_dotenv()
        supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_ANON_KEY"))

    decode_table = compile_csv(csv_path)
    print(f"Compiled {len(decode_table)} message(s) from {csv_path}\n")

    # Parse the header to get log start date/time
    with open(nfr_path, "rb") as f:
        header = f.read(HEADER_SIZE)
    date_str, time_str, start_dt = parse_header(header)
    print(f"Log date: {date_str}  start time: {time_str}\n")

    session_id = extract_session_id(nfr_path)
    if upload_to_db:
        print(f"Uploading to Supabase (session_id={session_id})\n")

    # Build a lookup from signal name -> unit for each message
    signal_units = {}
    for msg in decode_table.values():
        for sig in msg.signals:
            signal_units[(msg.frame_id, sig.name)] = sig.unit or ""

    out_path = nfr_path.rsplit(".", 1)[0] + ".csv"
    db_batch = []
    BATCH_SIZE = 500

    with open(out_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["signal_name", "timestamp_ms", "value", "message_id", "message_name", "unit", "date", "start_time"])

        for timestamp, frame_id, data in read_frames_from_file(nfr_path):
            decoded = decode_frame(frame_id, data, decode_table)
            if not decoded:
                continue

            msg = decode_table[frame_id]
            msg_id_hex = f"0x{frame_id:X}"
            print(f"[{timestamp}ms] {msg.name} ({msg_id_hex}): {decoded}")

            for signal_name, value in decoded.items():
                unit = signal_units.get((frame_id, signal_name), "")
                writer.writerow([signal_name, timestamp, value, msg_id_hex, msg.name, unit, date_str, time_str])

                if supabase:
                    abs_time = start_dt + timedelta(milliseconds=timestamp)
                    db_batch.append({
                        "timestamp": abs_time.isoformat(),
                        "source": msg.name,
                        "signal_name": signal_name,
                        "value": value,
                        "unit": unit,
                        "session_id": session_id,
                    })
                    if len(db_batch) >= BATCH_SIZE:
                        supabase.table("nfr26_signals").insert(db_batch).execute()
                        print(f"  -> inserted {BATCH_SIZE} rows")
                        db_batch = []

    # Flush remaining rows
    if supabase and db_batch:
        supabase.table("nfr26_signals").insert(db_batch).execute()
        print(f"  -> inserted {len(db_batch)} rows")

    print(f"\nSaved to {out_path}")
    if supabase:
        print(f"Uploaded to Supabase (session_id={session_id})")


if __name__ == "__main__":
    main()
