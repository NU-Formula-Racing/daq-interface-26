def decode_frame(frame_id, data, decode_table):
    """
    Decode a single CAN frame.

    Parameters:
        frame_id: int
            The CAN message ID.

        data: bytes
            Raw payload bytes (variable length).

        decode_table: dict
            Mapping of frame_id -> MessageSpec.

    Returns:
        dict mapping signal name -> decoded physical value.
        Returns empty dict if frame_id is unknown or invalid.
    """

    # 1. Look up how to decode this message
    message = decode_table.get(frame_id)

    if message is None:
        # Unknown frame ID
        return {}

    # 2. Ensure payload is large enough
    if len(data) < message.required_bytes:
        # Not enough bytes to safely decode
        return {}

    # 3. Convert payload bytes to a single integer
    # endianess doesn't matter as we have a stream but use little
    payload = int.from_bytes(data, "little")

    decoded = {}

    # 4. Extract each signal
    for signal in message.signals:

        # Create mask for signal length
        mask = (1 << signal.length) - 1

        # Shift payload so signal starts at bit 0
        raw_value = (payload >> signal.start_bit) & mask

        # 5. Handle signed signals (sign extension)
        if signal.signed:
            sign_bit = 1 << (signal.length - 1)

            # If sign bit is set, convert to negative value
            if raw_value & sign_bit:
                raw_value = raw_value - (1 << signal.length)

        # 6. Apply scale and offset
        physical_value = raw_value * signal.scale + signal.offset

        decoded[signal.name] = physical_value

    return decoded
