import sys
import os
import struct
import time
from datetime import datetime, timezone
import serial
from dotenv import load_dotenv
from supabase import create_client
from compile import compile_csv
from decode import decode_frame

FRAME_SIZE = 18  # 4 timestamp + 4 id + 2 dlc + 8 data
DEFAULT_PORT = "/dev/tty.usbmodem326D377333331"
DEFAULT_BAUD = 9600
BATCH_SIZE = 50
RECONNECT_INTERVAL = 2  # seconds between reconnect attempts
IDLE_TIMEOUT = 10  # seconds of no data before ending session


def create_session(supabase):
    """Create a new session row and return its UUID."""
    now = datetime.now(timezone.utc)
    result = supabase.table("sessions").insert({
        "date": now.strftime("%Y-%m-%d"),
        "started_at": now.isoformat(),
    }).execute()
    session_uuid = result.data[0]["id"]
    print(f"  Created session {session_uuid}")
    return session_uuid


def end_session(supabase, session_uuid):
    """Set ended_at on the current session."""
    if not session_uuid:
        return
    now = datetime.now(timezone.utc)
    supabase.table("sessions").update({
        "ended_at": now.isoformat(),
    }).eq("id", session_uuid).execute()
    print(f"  Ended session {session_uuid}")


def open_serial(port, baud):
    """Try to open the serial port, return the connection or None."""
    try:
        ser = serial.Serial(port, baud, timeout=1)
        return ser
    except serial.SerialException:
        return None


def main():
    args = sys.argv[1:]
    if len(args) < 1:
        print("Usage: python upload.py <dbc_csv_path> [serial_port] [baud_rate]")
        sys.exit(1)

    csv_path = args[0]
    port = args[1] if len(args) > 1 else DEFAULT_PORT
    baud = int(args[2]) if len(args) > 2 else DEFAULT_BAUD

    # Compile decode table
    decode_table = compile_csv(csv_path)
    print(f"Compiled {len(decode_table)} message(s) from {csv_path}")

    # Build signal lookups
    signal_senders = {}
    for msg in decode_table.values():
        sender = msg.sender or msg.name or "unknown"
        for sig in msg.signals:
            signal_senders[(msg.frame_id, sig.name)] = sender

    # Collect all unique (source, signal_name, unit) from the decode table
    signals_set = set()
    for msg in decode_table.values():
        sender = msg.sender or msg.name or "unknown"
        for sig in msg.signals:
            unit = sig.unit or ""
            signals_set.add((sender, sig.name, unit))

    # Set up Supabase
    load_dotenv()
    supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_ANON_KEY"))

    # Upsert all signal definitions upfront
    signal_rows = [
        {"source": src, "signal_name": name, "unit": unit}
        for src, name, unit in signals_set
    ]
    if signal_rows:
        supabase.table("signal_definitions").upsert(
            signal_rows, on_conflict="source,signal_name"
        ).execute()
        print(f"Upserted {len(signal_rows)} signal definition(s)")

    # Load signal_id mapping
    signal_id_map = {}
    result = supabase.table("signal_definitions") \
        .select("id, source, signal_name") \
        .limit(10000) \
        .execute()
    for r in result.data:
        signal_id_map[(r["source"], r["signal_name"])] = r["id"]
    print(f"Loaded {len(signal_id_map)} signal ID mapping(s)")

    session_uuid = None
    total_inserted = 0

    try:
        while True:
            # Wait for device to appear
            print(f"\nWaiting for device on {port}...")
            ser = None
            while ser is None:
                ser = open_serial(port, baud)
                if ser is None:
                    time.sleep(RECONNECT_INTERVAL)

            # Device connected — start a new session
            print(f"Device connected on {port}")
            session_uuid = create_session(supabase)
            print("Listening for frames...\n")

            db_batch = []
            buf = b""
            last_data_time = time.time()

            try:
                while True:
                    chunk = ser.read(max(1, ser.in_waiting))
                    if not chunk:
                        if time.time() - last_data_time > IDLE_TIMEOUT:
                            print(f"\nNo data for {IDLE_TIMEOUT}s — ending session.")
                            raise TimeoutError
                        continue

                    last_data_time = time.time()
                    buf += chunk

                    while len(buf) >= FRAME_SIZE:
                        frame = buf[:FRAME_SIZE]
                        buf = buf[FRAME_SIZE:]

                        timestamp_ms, frame_id, dlc = struct.unpack_from("<IIH", frame, 0)
                        data = frame[10:10 + dlc]

                        decoded = decode_frame(frame_id, data, decode_table)
                        if not decoded:
                            continue

                        msg = decode_table[frame_id]
                        now = datetime.now(timezone.utc)

                        for signal_name, value in decoded.items():
                            sender = signal_senders.get((frame_id, signal_name), msg.name or "unknown")
                            sig_id = signal_id_map.get((sender, signal_name))
                            if sig_id is None:
                                continue

                            print(f"[{timestamp_ms}ms] {signal_name} = {value}")

                            db_batch.append({
                                "timestamp": now.isoformat(),
                                "signal_id": sig_id,
                                "value": float(value),
                            })

                            if len(db_batch) >= BATCH_SIZE:
                                supabase.table("rt_readings").insert(db_batch).execute()
                                total_inserted += len(db_batch)
                                print(f"  -> inserted {total_inserted} rows")
                                db_batch = []

            except (serial.SerialException, OSError, TimeoutError):
                # Device disconnected — flush, end session, loop back to reconnect
                print("\nDevice disconnected.")
                if db_batch:
                    supabase.table("rt_readings").insert(db_batch).execute()
                    total_inserted += len(db_batch)
                end_session(supabase, session_uuid)
                ser.close()

    except KeyboardInterrupt:
        print("\nStopping...")
        if session_uuid:
            end_session(supabase, session_uuid)
        print(f"Done. Inserted {total_inserted} rows total.")


if __name__ == "__main__":
    main()
