class SignalSpec:
    """
    Describes how to decode a single signal from a CAN frame payload.

    All bit positions are absolute:
    bit 0 is the least-significant bit of byte 0.
    """

    def __init__(self, name, start_bit, length, signed, scale, offset,
                 unit=None, min_value=None, max_value=None):
        if start_bit < 0:
            raise ValueError("start_bit must be >= 0")

        if length <= 0:
            raise ValueError("length must be > 0")

        self.name = name
        self.start_bit = start_bit
        self.length = length
        self.signed = signed
        self.scale = scale
        self.offset = offset

        # Optional metadata
        self.unit = unit
        self.min_value = min_value
        self.max_value = max_value

    def __repr__(self):
        return (
            f"SignalSpec(name={self.name}, start_bit={self.start_bit}, "
            f"length={self.length}, signed={self.signed})"
        )


class MessageSpec:
    """
    Describes how to decode an entire CAN message (frame).
    """

    def __init__(self, frame_id, name, signals, required_bytes, sender=None):
        if frame_id < 0:
            raise ValueError("frame_id must be non-negative")

        if not signals:
            raise ValueError("MessageSpec must contain at least one signal")

        self.frame_id = frame_id
        self.name = name
        self.signals = signals
        self.required_bytes = required_bytes
        self.sender = sender

    def __repr__(self):
        return (
            f"MessageSpec(frame_id=0x{self.frame_id:X}, "
            f"name={self.name}, signals={len(self.signals)})"
        )
