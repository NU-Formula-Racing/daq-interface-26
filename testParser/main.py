import sys
from compile import compile_csv
from decode import decode_frame

def read_frames_from_file(file_path):
    # Generator that reads frames from a binary file.
    # Format: time, 4byte id, 1byte length, N byte data
    pass


def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <dbc_csv_path>")
        sys.exit(1)

    csv_path = sys.argv[1]
    decode_table = compile_csv(csv_path)

    print(f"Compiled {len(decode_table)} message(s) from {csv_path}\n")

    for frame_id, msg in sorted(decode_table.items()):
        print(f"Message: {msg.name} (ID: 0x{frame_id:X}, sender: {msg.sender}, {msg.required_bytes} bytes)")
        for sig in msg.signals:
            sign = "signed" if sig.signed else "unsigned"
            unit = sig.unit if sig.unit else ""
            print(f"  Signal: {sig.name}")
            print(f"    start_bit={sig.start_bit}, length={sig.length}, {sign}")
            print(f"    scale={sig.scale}, offset={sig.offset}, unit={unit}")
        print()
    
    


main()
