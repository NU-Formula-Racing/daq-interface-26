// src/lib/fetchSignals.ts
import { supabase } from "./supabaseClient";

// Fetch the most recent readings for a signal from rt_readings
// (used for live mode quick lookups)
export async function fetchSignal(signalId: number, limit = 100) {
    const { data, error } = await supabase
        .from("rt_readings")
        .select("timestamp, value")
        .eq("signal_id", signalId)
        .order("timestamp", { ascending: false })
        .limit(limit);
    if (error) console.error(error);
    return data || [];
}
