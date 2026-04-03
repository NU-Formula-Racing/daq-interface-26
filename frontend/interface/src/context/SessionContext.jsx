import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { supabase } from "@/lib/supabaseClient";
import { fetchAllRows } from "@/lib/paginatedFetch";

const SessionContext = createContext(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Helper: load persisted state from localStorage
// ---------------------------------------------------------------------------
function loadPersistedState() {
  try {
    const raw = localStorage.getItem("daqSession");
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt data
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function SessionProvider({ children }) {
  const persisted = useRef(loadPersistedState());

  // --- Core state -----------------------------------------------------------
  const [mode, setModeState] = useState(
    persisted.current?.mode === "replay" ? "replay" : "live"
  );
  const [sessionId, setSessionIdState] = useState(
    persisted.current?.mode === "replay"
      ? persisted.current.sessionId ?? null
      : null
  );

  // Signal definitions catalog (loaded once on mount)
  const [signalDefs, setSignalDefs] = useState(new Map()); // id -> {signal_name, source, unit}
  const [signalDefsReady, setSignalDefsReady] = useState(false);

  // Signals available in the current replay session
  const [sessionSignals, setSessionSignals] = useState([]); // [{signal_id, signal_name, source, unit}]

  // Separate data stores for live and replay
  const [liveSessionData, setLiveSessionData] = useState([]);
  const [replaySessionData, setReplaySessionData] = useState([]);

  // availableSessions is now array of session objects: {id, started_at, ended_at, track, driver}
  const [availableSessions, setAvailableSessions] = useState([]);
  const [selectedDate, setSelectedDateState] = useState(
    persisted.current?.selectedDate ?? new Date().toISOString().split("T")[0]
  );
  const [replayPosition, setReplayPositionState] = useState(
    persisted.current?.mode === "replay"
      ? persisted.current.replayPosition ?? 0
      : null
  );
  const [liveSignals, setLiveSignals] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // Unified sessionData: returns the data for the current mode
  const sessionData = useMemo(
    () => (mode === "live" ? liveSessionData : replaySessionData),
    [mode, liveSessionData, replaySessionData]
  );

  // Refs for values needed inside callbacks to avoid stale closures
  const channelRef = useRef(null);
  const sessionIdRef = useRef(sessionId);
  const modeRef = useRef(mode);
  const signalDefsRef = useRef(signalDefs);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    signalDefsRef.current = signalDefs;
  }, [signalDefs]);

  // --- localStorage persistence ---------------------------------------------
  useEffect(() => {
    localStorage.setItem(
      "daqSession",
      JSON.stringify({ mode, sessionId, selectedDate, replayPosition })
    );
  }, [mode, sessionId, selectedDate, replayPosition]);

  // --- Load signal_definitions once on mount --------------------------------
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("signal_definitions")
        .select("id, signal_name, source, unit");
      if (error) {
        console.error("Failed to load signal_definitions:", error);
        return;
      }
      const map = new Map();
      for (const d of data) {
        map.set(d.id, {
          signal_name: d.signal_name,
          source: d.source,
          unit: d.unit,
        });
      }
      setSignalDefs(map);
      setSignalDefsReady(true);
    })();
  }, []);

  // --- Supabase helpers -----------------------------------------------------

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // =========================================================================
  // LIVE MODE helpers
  // =========================================================================

  /** Load current rt_readings and resolve signal names via signalDefs. */
  const loadTodayLiveData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: readings, error } = await supabase
        .from("rt_readings")
        .select("timestamp, signal_id, value")
        .order("timestamp", { ascending: true });

      if (error) {
        console.error("Error loading rt_readings:", error);
        setLiveSessionData([]);
        return null;
      }

      const defs = signalDefsRef.current;
      const rows = (readings || [])
        .map((r) => {
          const def = defs.get(r.signal_id);
          if (!def) return null;
          return {
            timestamp: r.timestamp,
            signal_name: def.signal_name,
            value: r.value,
            unit: def.unit,
            source: def.source,
          };
        })
        .filter(Boolean);

      setLiveSessionData(rows);

      // Find today's latest session (if any) for display
      const today = new Date().toISOString().split("T")[0];
      const { data: sessions } = await supabase
        .from("sessions")
        .select("id")
        .eq("date", today)
        .order("started_at", { ascending: false })
        .limit(1);

      return sessions?.[0]?.id ?? null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const subscribeToRealtime = useCallback(() => {
    unsubscribe();

    const ch = supabase
      .channel("rt-signals-stream")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "rt_readings",
        },
        (payload) => {
          const { signal_id, value, timestamp } = payload.new;
          const def = signalDefsRef.current.get(signal_id);
          if (!def) return;

          setLiveSignals((prev) => ({
            ...prev,
            [def.signal_name]: { value, timestamp },
          }));
        }
      )
      .subscribe();

    channelRef.current = ch;
  }, [unsubscribe]);

  // =========================================================================
  // REPLAY MODE helpers
  // =========================================================================

  /** Load bucketed overview data for a session (all signals, 1-second buckets). */
  const loadReplaySessionData = useCallback(async (sid) => {
    if (sid == null) {
      setReplaySessionData([]);
      setSessionSignals([]);
      return;
    }
    setIsLoading(true);
    try {
      // Fetch bucketed overview via RPC (paginated to handle large sessions)
      const rows = await fetchAllRows((sb) =>
        sb.rpc("get_session_overview", {
          p_session_id: sid,
          p_bucket_secs: 1,
        })
      );

      // Shape matches old format: {timestamp, signal_name, value, unit, source}
      const mapped = (rows || []).map((r) => ({
        timestamp: r.timestamp,
        signal_name: r.signal_name,
        value: r.value,
        unit: r.unit,
        source: r.source,
        session_id: sid,
      }));
      setReplaySessionData(mapped);

      // Also fetch the distinct signals for this session
      const { data: signals } = await supabase.rpc("get_session_signals", {
        p_session_id: sid,
      });
      setSessionSignals(signals || []);
    } catch (err) {
      console.error("Error loading replay session data:", err);
      setReplaySessionData([]);
      setSessionSignals([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Replay mode: fetch available sessions for a given date, auto-select
   * the first one, and load its data.
   */
  const fetchSessionsForDate = useCallback(
    async (date) => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id, session_number, started_at, ended_at, track, driver")
          .eq("date", date)
          .order("started_at", { ascending: true });

        if (error) {
          console.error("Error fetching sessions:", error);
          setAvailableSessions([]);
          setSessionIdState(null);
          setReplaySessionData([]);
          return;
        }

        setAvailableSessions(data || []);

        if (data && data.length > 0) {
          const session = data[0];
          setSessionIdState(session.id);
          await loadReplaySessionData(session.id);
        } else {
          setSessionIdState(null);
          setReplaySessionData([]);
          setSessionSignals([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [loadReplaySessionData]
  );

  // --- Fetch dates with data (for calendar highlights) --------------------

  const fetchDatesWithData = useCallback(async ({ start, end }) => {
    // Extract date strings from ISO timestamps
    const startDate =
      typeof start === "string" && start.includes("T")
        ? start.split("T")[0]
        : start instanceof Date
          ? start.toISOString().split("T")[0]
          : start;
    const endDate =
      typeof end === "string" && end.includes("T")
        ? end.split("T")[0]
        : end instanceof Date
          ? end.toISOString().split("T")[0]
          : end;

    const { data, error } = await supabase
      .from("sessions")
      .select("date")
      .gte("date", startDate)
      .lte("date", endDate);

    if (error) {
      console.error("Error fetching dates with data:", error);
      return new Set();
    }

    return new Set((data || []).map((r) => r.date));
  }, []);

  // --- Actions exposed via context -----------------------------------------

  const setMode = useCallback((newMode) => {
    setModeState(newMode);
  }, []);

  const setSessionId = useCallback(
    (id) => {
      setSessionIdState(id);
      if (modeRef.current === "replay") {
        loadReplaySessionData(id);
      }
    },
    [loadReplaySessionData]
  );

  const setSelectedDate = useCallback((date) => {
    setSelectedDateState(date);
  }, []);

  const setReplayPosition = useCallback((pos) => {
    setReplayPositionState(pos);
  }, []);

  /** Fetch raw signal data for a time window (used by Graphs zoom).
   *  Returns per-signal data in the old flat format. */
  const fetchSignalWindow = useCallback(
    async (sid, signalId, startIso, endIso) => {
      if (sid == null || signalId == null) return [];
      const { data, error } = await supabase.rpc("get_signal_window", {
        p_session_id: sid,
        p_signal_id: signalId,
        p_start: startIso,
        p_end: endIso,
      });
      if (error) {
        console.error("Error fetching signal window:", error);
        return [];
      }
      const def = signalDefs.get(signalId);
      return (data ?? []).map((r) => ({
        timestamp: r.timestamp,
        signal_name: def?.signal_name ?? `signal_${signalId}`,
        value: r.value,
        unit: def?.unit,
        source: def?.source,
        session_id: sid,
      }));
    },
    [signalDefs]
  );

  /** Fetch downsampled data for a single signal (used by Graphs). */
  const fetchSignalDownsampled = useCallback(
    async (sid, signalId, bucketSeconds = 1) => {
      if (sid == null || signalId == null) return [];
      const bucketInterval = `${bucketSeconds} seconds`;
      const { data, error } = await supabase.rpc("get_signal_downsampled", {
        p_session_id: sid,
        p_signal_id: signalId,
        p_bucket: bucketInterval,
      });
      if (error) {
        console.error("Error fetching downsampled signal:", error);
        return [];
      }
      const def = signalDefs.get(signalId);
      return (data ?? []).map((r) => ({
        timestamp: r.bucket,
        signal_name: def?.signal_name ?? `signal_${signalId}`,
        value: r.avg_value,
        unit: def?.unit,
        source: def?.source,
      }));
    },
    [signalDefs]
  );

  /** Download ALL raw data for a session as CSV */
  const downloadFullSessionCsv = useCallback(
    async (sid, date) => {
      if (sid == null) return;

      const rows = await fetchAllRows((sb) =>
        sb
          .from("sd_readings")
          .select("timestamp, signal_id, value")
          .eq("session_id", sid)
          .order("timestamp", { ascending: true })
      );

      if (rows.length === 0) return;

      // Resolve signal names from signalDefs
      const enriched = rows.map((r) => {
        const def = signalDefs.get(r.signal_id);
        return {
          timestamp: r.timestamp,
          signal_name: def?.signal_name || `signal_${r.signal_id}`,
          value: r.value,
        };
      });

      const signalNames = [
        ...new Set(enriched.map((r) => r.signal_name)),
      ].sort();
      const timestamps = [
        ...new Set(enriched.map((r) => r.timestamp)),
      ].sort();

      const header = ["timestamp", ...signalNames].join(",");
      const csvRows = timestamps.map((ts) => {
        const rowData = enriched.filter((r) => r.timestamp === ts);
        const values = signalNames.map((name) => {
          const match = rowData.find((r) => r.signal_name === name);
          return match ? match.value : "";
        });
        return [ts, ...values].join(",");
      });

      const csv = [header, ...csvRows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NFR_Session_${date || "export"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [signalDefs]
  );

  // --- Effects -------------------------------------------------------------

  // ---- LIVE MODE ----
  useEffect(() => {
    if (mode !== "live" || !signalDefsReady) return;
    let cancelled = false;

    unsubscribe();
    setSessionIdState(null);

    (async () => {
      const sid = await loadTodayLiveData();
      if (cancelled) return;
      setSessionIdState(sid);
      subscribeToRealtime();
      setReplayPositionState(null);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, signalDefsReady]);

  // ---- REPLAY MODE ----
  useEffect(() => {
    if (mode !== "replay") return;
    unsubscribe();
    setReplayPositionState(0);

    if (selectedDate) {
      fetchSessionsForDate(selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedDate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  // --- Context value -------------------------------------------------------

  const value = {
    // State
    mode,
    sessionId,
    sessionData,
    liveSessionData,
    replaySessionData,
    availableSessions,
    selectedDate,
    replayPosition,
    liveSignals,
    isLoading,
    signalDefs,
    sessionSignals,

    // Actions
    setMode,
    setSessionId,
    setSelectedDate,
    setReplayPosition,
    fetchSessionsForDate,
    fetchDatesWithData,
    fetchSignalWindow,
    fetchSignalDownsampled,
    downloadFullSessionCsv,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
