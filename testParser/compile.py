import csv
from signalSpec import SignalSpec, MessageSpec


def compile_csv(csv_path):
    """
    Read a DBC-style CSV file and compile it into a decode table.

    Returns:
        decode_table: dict mapping frame_id -> MessageSpec
    """

    decode_table = {}

    # Open and read the CSV file
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)

        current_frame_id = None
        current_message_name = None
        current_sender = None

        # Temporary storage for signals belonging to the current message
        current_signals = []

        for row in reader:
            # 1. Determine the message ID
            # If Message ID is empty, it belongs to the previous message
            if row["Message ID"]:
                # Finish the previous message (if any)
                if current_frame_id is not None:
                    _finalize_message(
                        decode_table,
                        current_frame_id,
                        current_message_name,
                        current_sender,
                        current_signals,
                    )

                # Start a new message
                current_frame_id = int(row["Message ID"], 16)
                current_message_name = row["Message Name"]
                current_sender = row.get("Sender")
                current_signals = []

            # 2. Create a SignalSpec from the row
            signal_name = row["Signal Name"]
            start_bit = int(row["Start Bit"])
            length = int(row["Size (bits)"])
            scale = float(row["Factor"])
            offset = float(row["Offset"])

            # Determine signed vs unsigned from Data Type
            data_type = row["Data Type"].lower()
            signed = data_type.startswith("int") and not data_type.startswith("uint")

            unit = row.get("Unit") or None

            signal = SignalSpec(
                name=signal_name,
                start_bit=start_bit,
                length=length,
                signed=signed,
                scale=scale,
                offset=offset,
                unit=unit,
            )

            current_signals.append(signal)

        # 3. Finalize the last message in the file
        if current_frame_id is not None:
            _finalize_message(
                decode_table,
                current_frame_id,
                current_message_name,
                current_sender,
                current_signals,
            )

    return decode_table


def _finalize_message(decode_table, frame_id, name, sender, signals):
    """
    Helper function to turn a list of SignalSpecs into a MessageSpec
    and store it in the decode table.
    """

    # Compute how many bytes are required to decode this message
    max_bit = 0
    for sig in signals:
        end_bit = sig.start_bit + sig.length
        if end_bit > max_bit:
            max_bit = end_bit

    required_bytes = (max_bit + 7) // 8  # round up to full bytes

    message = MessageSpec(
        frame_id=frame_id,
        name=name,
        signals=signals,
        required_bytes=required_bytes,
        sender=sender,
    )

    decode_table[frame_id] = message
