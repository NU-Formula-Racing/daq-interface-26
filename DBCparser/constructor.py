### NORTHWESTERN FORMULA RACING 2023-24
# This Python script takes a .csv CAN DBC file and creates C++ code with signals and messages.
# by Ryan Beam, for DAQ Logger

# To run the script, create or download a CAN DBC .csv and place it in the folder.

# CSV FILE
# Format your CAN DBC .csv file columns and values to match this example:
# Message ID, Message Name,   Sender,  Signal Name, Start Bit, Size, Factor, Offset, Min, Max, Unit, Cycle Time, TXRX
# 200,        BMS_Voltages_0, ['BMS'], Cell_V_0,    0,         8,    0.012,  2,      ,    ,    V,    100,        TX

# Imported Libraries, py -m pip install <library> in VSCode terminal
import pandas as pd
import os

# Part 1 - Classes
class CANSignal: # represents a CAN signal
    def __init__(self, signal_name: str, signal_type: str, position: int, length: int, factor: float, offset: int, unit: str, sign: str = "Signed"):
        if sign.lower() == "signed":
            self.Make = "MakeSignedCANSignal"
        elif sign.lower() == "unsigned":
            self.Make = "MakeUnsignedCANSignal"
        else:
            raise ValueError('Type must be either "signed" or "unsigned".')
        self.Signal_Name = signal_name
        self.Signal_Type = signal_type
        self.Position = position
        self.Length = length
        self.Factor = factor
        self.Offset = offset
        self.Unit = unit

    def construct_signal(self):
        return f"{self.Make}({self.Signal_Type}, {self.Position}, {self.Length}, {self.Factor}, {self.Offset}) {self.Signal_Name}{{}};"

# Note: CANMessage defaults to RX messages for my project. Include a "TXRX" column in your DBC or edit the code to make TX messages.
class CANMessage: # represents a CAN Message
    def __init__(self, message_name: str, message_id: str, size: int, can_bus: str = "can_bus", txrx: str = "RX"): # Change "RX" to "TX" to default to TX messages
        self.Message_Name = message_name
        self.Message_ID = message_id
        self.Size = size
        self.CAN_Bus = can_bus
        self.TXRX = txrx.upper()
        if self.TXRX not in ["TX","RX"]:
            self.TXRX = "RX" # This catches errors to default back to RX, change if you want to default back to TX
        self.Signals: list['CANSignal'] = []

    def construct_message(self):
        assert self.Size == len(self.Signals), f"Size ({self.Size}) should be the number of signals ({len(self.Signals)})."
        message_str = f"CAN{self.TXRX}Message<{self.Size}> {self.Message_Name}{"{"}{self.CAN_Bus}, 0x{self.Message_ID}, []() {{ Serial.println({self.Message_Name}.GetLastReceiveTime()); }}, "
        for signal in self.Signals:
            message_str += f"{signal.Signal_Name}, "
        message_str = message_str.removesuffix(", ")+"};"
        return message_str

# Part 2 - C++ Code Creation (C^3)
file = [file for file in os.listdir("DBCparser") if file.endswith(".csv")][0] # Note: Only 1 .csv in the folder at a time
data = pd.read_csv(fr"DBCparser/{file}")
data = data.groupby("Message ID")

CANmessages: list['CANMessage'] = []
for i,df in data:
    df = df.reset_index(drop=True)
    message_name = df.loc[0,"Message Name"]
    size = df.shape[0]
    signals = []
    for _,row in df.iterrows():
        signals.append(CANSignal(row["Signal Name"], "float", row["Start Bit"], row["Size"], row["Factor"], row["Offset"], row["Unit"]))
    if "TXRX" in [col.upper() for col in list(df.columns)]:
        txrx = row["TXRX"]
        message = CANMessage(message_name, i, size, txrx)
    else:
        message = CANMessage(message_name, i, size)
    CANmessages.append(message)
    message.Signals = signals

with open("DBCparser/CAN_MSG.cpp","w") as f:
    message: CANMessage
    # The file is set up for ESP, but you can copy/paste to your own code so it doesn't matter
    f.write("//Generated CAN Code\n#include <esp_can.h>\nESPCAN can_bus{};\n\n")
    for message in CANmessages:
        f.write(f"// Message: {message.Message_Name}\n")
        for signal in message.Signals:
            f.write(f"{signal.construct_signal()}\n")
        f.write("\n")
        f.write(f"{message.construct_message()}\n")
        f.write("\n")