import { useNavigate } from "react-router-dom";
import { useSession } from "@/context/SessionContext";

export default function ModeToggle() {
  const { mode, setMode } = useSession();
  const navigate = useNavigate();

  const handleClick = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    navigate(newMode === "live" ? "/dashboard" : "/replay");
  };

  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "999px",
        padding: "2px",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <button
        onClick={() => handleClick("live")}
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "0.68rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "5px 16px",
          borderRadius: "999px",
          border: "none",
          cursor: "pointer",
          transition: "all 0.2s ease",
          background:
            mode === "live" ? "#4ade80" : "transparent",
          color:
            mode === "live" ? "#0a0a0f" : "rgba(255,255,255,0.35)",
          boxShadow: "none",
          fontWeight: mode === "live" ? 700 : 500,
        }}
      >
        Live
      </button>
      <button
        onClick={() => handleClick("replay")}
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "0.68rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "5px 16px",
          borderRadius: "999px",
          border: "none",
          cursor: "pointer",
          transition: "all 0.2s ease",
          background:
            mode === "replay" ? "#4E2A84" : "transparent",
          color:
            mode === "replay" ? "#f0f0f0" : "rgba(255,255,255,0.35)",
          boxShadow: "none",
          fontWeight: mode === "replay" ? 700 : 500,
        }}
      >
        Replay
      </button>
    </div>
  );
}
