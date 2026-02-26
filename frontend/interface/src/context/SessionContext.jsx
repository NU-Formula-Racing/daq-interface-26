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
// Helper: build start/end-of-day timestamps for a date string or Date
// ---------------------------------------------------------------------------
function dayRange(date) {
  // If date is a string like "2026-02-14", append T00:00:00 so it's
  // parsed in local time instead of UTC (date-only strings default to UTC).
  const d = typeof date === "string" && !date.includes("T")
    ? new Date(date + "T00:00:00")
    : new Date(date);
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function SessionProvider({ children }) {
  const persisted = useRef(loadPersistedState());

  // --- State ---------------------------------------------------------------
  const [mode, setModeState] = useState(
    persisted.current?.mode === "replay" ? "replay" : "live"
  );
  const [sessionId, setSessionIdState] = useState(
    persisted.current?.mode === "replay" ? persisted.current.sessionId ?? null : null
  );

  // SEPARATE data stores for live and replay
  const [liveSessionData, setLiveSessionData] = useState([]);
  const [replaySessionData, setReplaySessionData] = useState([]);

  const [availableSessions, setAvailableSessions] = useState([]);
  const [selectedDate, setSelectedDateState] = useState(
    persisted.current?.selectedDate ?? new Date().toISOString().split("T")[0]
  );
  const [replayPosition, setReplayPositionState] = useState(
    persisted.current?.mode === "replay" ? persisted.current.replayPosition ?? 0 : null
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

  // Keep refs in sync
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // --- localStorage persistence -------------------------------------------
  useEffect(() => {
    localStorage.setItem(
      "daqSession",
      JSON.stringify({ mode, sessionId, selectedDate, replayPosition })
    );
  }, [mode, sessionId, selectedDate, replayPosition]);

  // --- Supabase helpers ----------------------------------------------------

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // =========================================================================
  // LIVE MODE helpers
  // =========================================================================

  /** Load today's signals for live mode. Returns the session_id found.
   *  Only considers the car "live" if the most recent signal arrived
   *  within the last 30 seconds. */
  const loadTodayLiveData = useCallback(async () => {
    const { start, end } = dayRange(new Date());

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("nfr26_signals")
        .select("*")
        .gte("timestamp", start)
        .lte("timestamp", end)
        .order("timestamp", { ascending: true });

      if (error) {
        console.error("Error loading today's live data:", error);
        setLiveSessionData([]);
        return null;
      }

      const rows = data ?? [];
      setLiveSessionData(rows);

      if (rows.length === 0) return null;

      // Only report a live session if there is data from today
      const today = new Date().toISOString().split("T")[0];
      const newestRow = rows[rows.length - 1];
      const newestDate = newestRow.timestamp.split("T")[0];
      if (newestDate !== today) return null;

      // Derive session_id from the most recent row that has one
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].session_id != null) return rows[i].session_id;
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const subscribeToRealtime = useCallback(() => {
    unsubscribe();

    const ch = supabase
      .channel("session-signals-stream")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "nfr26_signals",
        },
        (payload) => {
          const row = payload.new;

          // If the incoming row has a different session_id, auto-switch
          if (
            row.session_id != null &&
            row.session_id !== sessionIdRef.current
          ) {
            setSessionIdState(row.session_id);
          }

          // Update liveSignals map
          setLiveSignals((prev) => ({
            ...prev,
            [row.signal_name]: {
              value: row.value,
              timestamp: row.timestamp,
            },
          }));
        }
      )
      .subscribe();

    channelRef.current = ch;
  }, [unsubscribe]);

  // =========================================================================
  // REPLAY MODE helpers
  // =========================================================================

  /** Load all signal rows for a given session_id into replay store */
  const loadReplaySessionData = useCallback(async (sid) => {
    if (sid == null) {
      setReplaySessionData([]);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("nfr26_signals")
        .select("*")
        .eq("session_id", sid)
        .order("timestamp", { ascending: true });

      if (error) {
        console.error("Error loading replay session data:", error);
        setReplaySessionData([]);
      } else {
        setReplaySessionData(data ?? []);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Replay mode: fetch available sessions for a given date, auto-select
   * the first one, and load its data directly.
   */
  const fetchSessionsForDate = useCallback(
    async (date) => {
      const { start, end } = dayRange(date);

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("nfr26_signals")
          .select("session_id")
          .gte("timestamp", start)
          .lte("timestamp", end)
          .order("session_id", { ascending: true });

        if (error) {
          console.error("Error fetching sessions for date:", error);
          setAvailableSessions([]);
          return;
        }

        // Filter out null session_ids in JS
        const uniqueSessions = [
          ...new Set(data.map((r) => r.session_id).filter((id) => id != null)),
        ];
        setAvailableSessions(uniqueSessions);

        // Auto-select first available session and load its data directly
        if (uniqueSessions.length > 0) {
          const sid = uniqueSessions[0];
          setSessionIdState(sid);
          await loadReplaySessionData(sid);
        } else {
          setSessionIdState(null);
          setReplaySessionData([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [loadReplaySessionData]
  );

  // --- Fetch dates with data (for calendar highlights) --------------------

  const fetchDatesWithData = useCallback(async ({ start, end }) => {
    // Check each day of the month individually with limit(1).
    // This avoids the 1000-row default limit that caused dates to be missed
    // when there are thousands of signal rows in a month.
    const dates = new Set();
    const queries = [];
    const d = new Date(start);
    const endDate = new Date(end);

    while (d <= endDate) {
      const dayStr = d.toISOString().split("T")[0];
      const dayStart = `${dayStr}T00:00:00.000Z`;
      const dayEnd = `${dayStr}T23:59:59.999Z`;
      queries.push(
        supabase
          .from("nfr26_signals")
          .select("timestamp")
          .gte("timestamp", dayStart)
          .lte("timestamp", dayEnd)
          .limit(1)
          .then(({ data }) => {
            if (data?.length) dates.add(dayStr);
          })
      );
      d.setDate(d.getDate() + 1);
    }

    await Promise.all(queries);
    return dates;
  }, []);

  // --- Actions exposed via context -----------------------------------------

  const setMode = useCallback((newMode) => {
    setModeState(newMode);
  }, []);

  const setSessionId = useCallback((id) => {
    setSessionIdState(id);
    // In replay mode, load data directly (avoids stale state if id is same)
    if (modeRef.current === "replay") {
      loadReplaySessionData(id);
    }
  }, [loadReplaySessionData]);

  const setSelectedDate = useCallback((date) => {
    setSelectedDateState(date);
  }, []);

  const setReplayPosition = useCallback((pos) => {
    setReplayPositionState(pos);
  }, []);

  // --- Effects -------------------------------------------------------------

  // ---- LIVE MODE ----
  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;

    unsubscribe();
    // Clear stale session immediately — only re-set if today's data exists
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
  }, [mode]);

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
    sessionData,          // unified: returns live or replay data based on mode
    liveSessionData,      // live mode only
    replaySessionData,    // replay mode only
    availableSessions,
    selectedDate,
    replayPosition,
    liveSignals,
    isLoading,

    // Actions
    setMode,
    setSessionId,
    setSelectedDate,
    setReplayPosition,
    fetchSessionsForDate,
    fetchDatesWithData,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
