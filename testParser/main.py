import sys
import csv
import struct
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
    return date_str, time_str


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
    if len(sys.argv) < 3:
        print("Usage: python main.py <dbc_csv_path> <nfr_file_path>")
        sys.exit(1)

    csv_path = sys.argv[1]
    nfr_path = sys.argv[2]

    decode_table = compile_csv(csv_path)
    print(f"Compiled {len(decode_table)} message(s) from {csv_path}\n")

    # Parse the header to get log start date/time
    with open(nfr_path, "rb") as f:
        header = f.read(HEADER_SIZE)
    date_str, time_str = parse_header(header)
    print(f"Log date: {date_str}  start time: {time_str}\n")

    # Build a lookup from signal name -> unit for each message
    signal_units = {}
    for msg in decode_table.values():
        for sig in msg.signals:
            signal_units[(msg.frame_id, sig.name)] = sig.unit or ""

    out_path = nfr_path.rsplit(".", 1)[0] + ".csv"
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

    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
