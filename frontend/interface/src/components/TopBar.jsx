import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Download, Menu, X } from "lucide-react";
import { motion } from "framer-motion";
import { useSession } from "@/context/SessionContext";
import useIsMobile from "@/hooks/useIsMobile";
import logo from "@/assets/nfr_logo.png";
import ModeToggle from "./ModeToggle";
import SessionIndicator from "./SessionIndicator";
import "./TopBar.css";

export default function TopBar() {
  const { sessionData, sessionId, selectedDate, mode } = useSession();
  const isMobile = useIsMobile();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleCsvDownload = () => {
    if (!sessionData.length) return;

    // Get unique signal names and timestamps
    const signalNames = [
      ...new Set(sessionData.map((d) => d.signal_name)),
    ].sort();
    const timestamps = [
      ...new Set(sessionData.map((d) => d.timestamp)),
    ].sort();

    // Build header
    const header = ["timestamp", ...signalNames].join(",");

    // Build rows - pivot data
    const rows = timestamps.map((ts) => {
      const rowData = sessionData.filter((d) => d.timestamp === ts);
      const values = signalNames.map((name) => {
        const match = rowData.find((d) => d.signal_name === name);
        return match ? match.value : "";
      });
      return [ts, ...values].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NFR_Session_${sessionId}_${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <nav className={`topbar ${isMobile ? "topbar--mobile" : ""}`}>
      {/* LEFT: Logo + Title */}
      <Link to="/" className="topbar-brand">
        <img
          src={logo}
          alt="NFR Logo"
          className="topbar-logo"
        />
        <span className="topbar-title">
          {isMobile ? "DAQ" : "DAQ INTERFACE"}
        </span>
      </Link>

      {/* CENTER: Mode Toggle + Nav Links */}
      <div className="topbar-center">
        <ModeToggle />
        {!isMobile && (
          <motion.div
            className="topbar-nav"
            animate={{
              opacity: mode === "replay" ? 1 : 0,
              pointerEvents: mode === "replay" ? "auto" : "none",
            }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          >
            <Link
              to="/replay"
              className={`topbar-nav-link ${location.pathname === "/replay" ? "topbar-nav-link--active" : ""}`}
              tabIndex={mode === "replay" ? 0 : -1}
            >
              REPLAY
            </Link>
            <Link
              to="/graphs"
              className={`topbar-nav-link ${location.pathname === "/graphs" ? "topbar-nav-link--active" : ""}`}
              tabIndex={mode === "replay" ? 0 : -1}
            >
              GRAPHS
            </Link>
          </motion.div>
        )}
      </div>

      {/* RIGHT: Desktop shows full controls, mobile shows hamburger */}
      {isMobile ? (
        <button
          className="topbar-hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      ) : (
        <div className="topbar-right">
          <SessionIndicator />
          <button
            onClick={handleCsvDownload}
            title="Download CSV"
            className="topbar-csv-btn"
          >
            <Download size={18} />
          </button>
        </div>
      )}

      {/* Mobile slide-down panel */}
      {isMobile && menuOpen && (
        <div className="topbar-mobile-panel">
          {mode === "replay" && (
            <div className="topbar-mobile-nav">
              <Link
                to="/replay"
                className={`topbar-nav-link ${location.pathname === "/replay" ? "topbar-nav-link--active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                REPLAY
              </Link>
              <Link
                to="/graphs"
                className={`topbar-nav-link ${location.pathname === "/graphs" ? "topbar-nav-link--active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                GRAPHS
              </Link>
            </div>
          )}
          <SessionIndicator />
          <button
            onClick={() => {
              handleCsvDownload();
              setMenuOpen(false);
            }}
            className="topbar-csv-btn"
            title="Download CSV"
          >
            <Download size={18} />
            <span className="topbar-csv-label">Download CSV</span>
          </button>
        </div>
      )}
    </nav>
  );
}
