# CAN Signal Decoder Architecture

This project implements a **runtime CAN signal decoder** driven by a DBC-style CSV file.
The system compiles signal definitions once at startup and decodes incoming CAN frames efficiently at runtime.

---

## Overview

The system is split into **compile-time** and **runtime** phases:

1. **Compile-time**:
   Parse and validate the CSV signal definitions and convert them into an efficient in-memory decoding table.

2. **Runtime**:
   Read CAN frames from a stream, look up the corresponding message definition, extract signal bits, and compute physical values.

This separation ensures fast, deterministic decoding and clean extensibility.

---

## Architecture

```
DBC CSV
  ↓
compile.py   (compile-time validation & normalization)
  ↓
spec.py      (data models: SignalSpec, MessageSpec)
  ↓
decode.py    (runtime decoding engine)
  ↑
stream.py    (CAN/log/socket frame source)
```

---

## Module Responsibilities

### `spec.py`

Defines the domain models used throughout the system.

* `SignalSpec`

  * Signal name
  * Start bit (absolute)
  * Bit length
  * Signed/unsigned
  * Scale and offset

* `MessageSpec`

  * CAN frame ID
  * Message name
  * List of `SignalSpec`

This module contains **no I/O and no runtime logic**.

---

### `compile.py`

Compile-time logic that converts the CSV into executable decoding metadata.

Responsibilities:

* Parse CSV rows
* Carry forward message IDs
* Normalize data types (signed/unsigned)
* Validate signal bounds and overlaps
* Group signals by message ID

Output:

```python
decode_table: dict[int, MessageSpec]
```

This code runs once at startup and may fail loudly if the CSV is invalid.

---

### `decode.py`

Runtime decoding engine.

Responsibilities:

* Accept `(frame_id, data_bytes)`
* Look up the corresponding `MessageSpec`
* Extract bit slices using absolute start bits
* Apply signed conversion, scale, and offset
* Return decoded signal values

This module is:

* Stateless
* Fast
* Side-effect free

---

### `stream.py`

Input layer that provides raw CAN frames.

Responsibilities:

* Read frames from a CAN bus, log file, socket, or replay source
* Yield `(timestamp, frame_id, data_bytes)`

This module knows nothing about signal definitions or decoding.

---

## Runtime Flow

```python
decode_table = compile_csv("dbc.csv")

for timestamp, frame_id, data in stream:
    values = decode_frame(frame_id, data, decode_table)
    consume(values)
```

---

## Design Principles

* Absolute bit positions eliminate runtime endianness concerns
* All structural validation happens at compile time
* Runtime decoding is simple bit slicing and math
* Input sources are fully decoupled from decoding logic

---

## When to Use Jupyter

Jupyter notebooks may be used for:

* Exploring the CSV
* Visualizing bit layouts
* Performing sanity checks

Decoding logic and runtime code should live exclusively in Python modules.

---

## Summary

This architecture treats the CSV as source code, the compiler as a validator, and the decoder as a lightweight execution engine.
The result is a fast, maintainable, and extensible CAN signal decoding system.
