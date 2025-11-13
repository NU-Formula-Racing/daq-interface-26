// src/lib/fetchSignals.ts
import { supabase } from "./supabaseClient";

export async function fetchSignal(signalName: string, limit = 100) {
    const { data, error } = await supabase
        .from("nfr26_signals")
        .select("timestamp, value")
        .eq("signal_name", signalName)
        .order("timestamp", { ascending: true })
        .limit(limit);
    if (error) console.error(error);
    return data || [];
}
