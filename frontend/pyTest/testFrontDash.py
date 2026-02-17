import time
import random
import os
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def generate_fake_rpm():
    # Example: 0–7000 rpm range
    return random.randint(0, 7000)

def generate_fake_igbt_temp():
    # Example: typical MOSFET / IGBT temperature range
    return round(random.uniform(25.0, 90.0), 2)

def insert_signal(source, signal_name, value, unit, sessionID):
    row = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "signal_name": signal_name,
        "value": value,
        "unit": unit,
        "session_id": sessionID
    }

    response = supabase.table("nfr26_signals").insert(row).execute()
    print(f"Sent → {row}")
    return response

def run_test():
    for i in range(40):
        print(f"\n--- Cycle {i+1} / 20 ---")

        # Generate fake values
        fake_rpm = generate_fake_rpm()
        fake_temp = generate_fake_igbt_temp()

        # Insert into Supabase
        insert_signal(
            source="Inverter",
            signal_name="Inverter_RPM",
            value=fake_rpm,
            unit="RPM",
            sessionID=1
        )

        insert_signal(
            source="Inverter",
            signal_name="IGBT_Temperature",
            value=fake_temp,
            unit="°C",
            sessionID=1
        )

        # Wait 2 seconds before next cycle
        time.sleep(2)
        
    print("\nDone — 40 cycles completed.")


if __name__ == "__main__":
    run_test()