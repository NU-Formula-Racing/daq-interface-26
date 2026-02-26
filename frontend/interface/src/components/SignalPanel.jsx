import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, ChevronDown, Eye, EyeOff, X } from "lucide-react";

const MAX_UNIT_TYPES = 3;

export default function SignalPanel({
  availableSignals,
  activeSignals,
  onAddSignal,
  onRemoveSignal,
  onToggleVisibility,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [warning, setWarning] = useState(null);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Clear warning after 3 seconds
  useEffect(() => {
    if (warning) {
      const t = setTimeout(() => setWarning(null), 3000);
      return () => clearTimeout(t);
    }
  }, [warning]);

  // Group available signals by unit (excluding already-active signals)
  const groupedAvailable = useMemo(() => {
    const activeNames = new Set(activeSignals.map((s) => s.name));
    const groups = {};
    availableSignals.forEach(({ name, unit }) => {
      if (activeNames.has(name)) return;
      const u = unit || "unknown";
      if (!groups[u]) groups[u] = [];
      groups[u].push({ name, unit: u });
    });
    return groups;
  }, [availableSignals, activeSignals]);

  // Group active signals by unit for display
  const activeByUnit = useMemo(() => {
    const groups = {};
    activeSignals.forEach((sig) => {
      const u = sig.unit || "unknown";
      if (!groups[u]) groups[u] = [];
      groups[u].push(sig);
    });
    return groups;
  }, [activeSignals]);

  // Current active unit types
  const activeUnitTypes = useMemo(
    () => new Set(activeSignals.map((s) => s.unit || "unknown")),
    [activeSignals]
  );

  const handleAddSignal = (signal) => {
    const unit = signal.unit || "unknown";
    if (!activeUnitTypes.has(unit) && activeUnitTypes.size >= MAX_UNIT_TYPES) {
      setWarning("Maximum 3 unit types supported");
      setDropdownOpen(false);
      return;
    }
    onAddSignal(signal);
    setDropdownOpen(false);
  };

  const hasAvailableSignals = Object.keys(groupedAvailable).length > 0;

  return (
    <div className="signal-panel">
      <div className="signal-panel-header">
        <span className="signal-panel-title">SIGNALS</span>
      </div>

      {/* Add Signal Button + Dropdown */}
      <div className="signal-add-wrapper" ref={dropdownRef}>
        <button
          className="signal-add-btn"
          onClick={() => setDropdownOpen((o) => !o)}
          disabled={!hasAvailableSignals}
        >
          <Plus size={14} />
          <span>ADD SIGNAL</span>
          <ChevronDown
            size={14}
            style={{
              transform: dropdownOpen ? "rotate(180deg)" : "rotate(0)",
              transition: "transform 0.2s ease",
              marginLeft: "auto",
            }}
          />
        </button>

        {dropdownOpen && hasAvailableSignals && (
          <div className="signal-dropdown">
            {Object.entries(groupedAvailable).map(([unit, signals]) => (
              <div key={unit} className="signal-dropdown-group">
                <div className="signal-dropdown-group-label">{unit}</div>
                {signals.map((sig) => (
                  <button
                    key={sig.name}
                    className="signal-dropdown-item"
                    onClick={() => handleAddSignal(sig)}
                  >
                    {sig.name}{" "}
                    <span className="signal-dropdown-unit">({sig.unit})</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Warning */}
      {warning && <div className="signal-warning">{warning}</div>}

      {/* Active signals grouped by unit */}
      <div className="signal-active-list">
        {Object.entries(activeByUnit).map(([unit, signals], groupIdx) => (
          <div key={unit} className="signal-unit-group">
            {groupIdx > 0 && <div className="signal-unit-divider" />}
            <div className="signal-unit-label">{unit}</div>
            {signals.map((sig) => (
              <div key={sig.name} className="signal-active-item">
                <span
                  className="signal-color-dot"
                  style={{ background: sig.color }}
                />
                <span className="signal-active-name">{sig.name}</span>
                <span className="signal-active-unit">{sig.unit}</span>
                <button
                  className="signal-toggle-btn"
                  onClick={() => onToggleVisibility(sig.name)}
                  title={sig.visible ? "Hide signal" : "Show signal"}
                >
                  {sig.visible ? (
                    <Eye size={14} />
                  ) : (
                    <EyeOff size={14} style={{ opacity: 0.4 }} />
                  )}
                </button>
                <button
                  className="signal-remove-btn"
                  onClick={() => onRemoveSignal(sig.name)}
                  title="Remove signal"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ))}

        {activeSignals.length === 0 && (
          <div className="signal-empty">
            No signals selected. Click ADD SIGNAL above.
          </div>
        )}
      </div>
    </div>
  );
}
