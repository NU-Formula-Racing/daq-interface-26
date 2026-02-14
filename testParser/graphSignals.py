import pandas as pd
import plotly.express as px
from compile import compile_csv
from decode import decode_frame
from main import read_frames_from_file

DBC_PATH = "testDBC.csv"
NFR_PATH = "testData/4_MSG.NFR"


def load_signals(dbc_path, nfr_path):
    decode_table = compile_csv(dbc_path)

    signal_units = {}
    for msg in decode_table.values():
        for sig in msg.signals:
            signal_units[(msg.frame_id, sig.name)] = sig.unit or ""

    rows = []
    for timestamp, frame_id, data in read_frames_from_file(nfr_path):
        decoded = decode_frame(frame_id, data, decode_table)
        if not decoded:
            continue
        msg = decode_table[frame_id]
        for signal_name, value in decoded.items():
            unit = signal_units.get((frame_id, signal_name), "")
            rows.append({
                "signal_name": signal_name,
                "timestamp_ms": timestamp,
                "value": value,
                "message_id": f"0x{frame_id:X}",
                "message_name": msg.name,
                "unit": unit,
            })

    return pd.DataFrame(rows)


def plot_message(df, message_name):
    msg_df = df[df["message_name"] == message_name]
    signals = msg_df["signal_name"].unique()

    fig = px.line(
        msg_df,
        x="timestamp_ms",
        y="value",
        facet_row="signal_name",
        title=f"{message_name} signals",
        labels={"timestamp_ms": "Time (ms)", "value": "Value"},
    )
    fig.update_yaxes(matches=None)
    fig.update_layout(height=250 * len(signals))
    fig.show()


def plot_signal(df, signal_name, message_name=None):
    sig_df = df[df["signal_name"] == signal_name]
    if message_name:
        sig_df = sig_df[sig_df["message_name"] == message_name]

    unit = sig_df["unit"].iloc[0] if len(sig_df) > 0 else ""
    y_label = f"{signal_name} ({unit})" if unit else signal_name

    fig = px.line(
        sig_df,
        x="timestamp_ms",
        y="value",
        title=signal_name,
        labels={"timestamp_ms": "Time (ms)", "value": y_label},
    )
    fig.show()


df = load_signals(DBC_PATH, NFR_PATH)
print(f"{len(df)} signal readings from {df['signal_name'].nunique()} unique signals")

plot_message(df, "ECU_Throttle")
plot_message(df, "Rear_Inverter_Motor_Status")
plot_signal(df, "RPM", "Rear_Inverter_Motor_Status")
