import { useRef, useState, useEffect, useCallback } from "react";
import { useSession } from "@/context/SessionContext";
import { motion } from "framer-motion";
import DatePicker from "@/components/DatePicker";
import "./TopBar.css";

export default function SessionIndicator() {
  const {
    mode,
    sessionId,
    selectedDate,
    setSelectedDate,
    availableSessions,
    setSessionId,
  } = useSession();

  const isLive = mode === "live";
  const liveRef = useRef(null);
  const replayRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const measure = useCallback(() => {
    const activeRef = isLive ? liveRef : replayRef;
    if (activeRef.current) {
      const { offsetWidth, offsetHeight } = activeRef.current;
      setContainerSize({ width: offsetWidth, height: offsetHeight });
    }
  }, [isLive]);

  useEffect(() => {
    measure();
  }, [measure, sessionId, availableSessions]);

  const inputStyle = {
    background: "var(--hud-bg)",
    border: "1px solid rgba(255,255,255,0.16)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    color: "#f0f0f0",
    borderRadius: "4px",
    padding: "4px 8px",
    outline: "none",
  };

  return (
    <motion.div
      animate={{ width: containerSize.width, height: containerSize.height }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
      style={{ position: "relative", overflow: "hidden" }}
    >
      {/* Live indicator */}
      <motion.div
        ref={liveRef}
        animate={{ opacity: isLive ? 1 : 0 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
        style={{
          display: "flex",
          alignItems: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "0.85rem",
          color: "#4ade80",
          pointerEvents: isLive ? "auto" : "none",
          position: "absolute",
          top: 0,
          right: 0,
          whiteSpace: "nowrap",
        }}
      >
        <span>SESSION #{sessionId ?? "---"}</span>
        <span style={{ margin: "0 6px" }}>&bull;</span>
        <span className="live-dot" />
        <span>LIVE</span>
      </motion.div>

      {/* Replay controls */}
      <motion.div
        ref={replayRef}
        animate={{ opacity: isLive ? 0 : 1 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          pointerEvents: isLive ? "none" : "auto",
          position: "absolute",
          top: 0,
          right: 0,
          whiteSpace: "nowrap",
        }}
      >
        <DatePicker value={selectedDate} onChange={setSelectedDate} />
        <select
          value={sessionId ?? ""}
          onChange={(e) => setSessionId(Number(e.target.value))}
          style={inputStyle}
        >
          {availableSessions.length === 0 && (
            <option value="">No sessions</option>
          )}
          {availableSessions.map((sid) => (
            <option key={sid} value={sid}>
              Session #{sid}
            </option>
          ))}
        </select>
      </motion.div>
    </motion.div>
  );
}
