// src/lib/fetchSignals.ts
import { supabase } from "./supabaseClient";

// get the most recent signals (ascendingL false)
export async function fetchSignal(signalName: string, limit = 100) {
    const { data, error } = await supabase
        .from("nfr26_signals")
        .select("timestamp, value")
        .eq("signal_name", signalName)
        .order("timestamp", { ascending: false })
        .limit(limit);
    if (error) console.error(error);
    return data || [];
}
