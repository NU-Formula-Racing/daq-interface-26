import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, ChevronDown, ChevronRight, Eye, EyeOff, X, Search } from "lucide-react";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

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

  // Focus search input when dropdown opens; reset search when closing
  useEffect(() => {
    if (dropdownOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } else {
      setSearchQuery("");
    }
  }, [dropdownOpen]);

  // Clear warning after 3 seconds
  useEffect(() => {
    if (warning) {
      const t = setTimeout(() => setWarning(null), 3000);
      return () => clearTimeout(t);
    }
  }, [warning]);

<<<<<<< HEAD
  // Group available signals by sender (excluding already-active signals)
  const groupedAvailable = useMemo(() => {
    const activeNames = new Set(activeSignals.map((s) => s.name));
    const groups = {};
    availableSignals.forEach(({ name, unit, sender }) => {
      if (activeNames.has(name)) return;
      const s = sender || "unknown";
      const u = unit || "unknown";
      if (!groups[s]) groups[s] = [];
      groups[s].push({ name, unit: u, sender: s });
=======
  // Group available signals by source (excluding already-active signals)
  const groupedBySource = useMemo(() => {
    const activeNames = new Set(activeSignals.map((s) => s.name));
    const groups = {};
    availableSignals.forEach((sig) => {
      if (activeNames.has(sig.name)) return;
      const source = sig.source || "Other";
      if (!groups[source]) groups[source] = [];
      groups[source].push(sig);
>>>>>>> 259bc57ec5f41f20fc2786778acafee1712d5981
    });

    // Ensure alphabetical signal order within each sender group.
    Object.values(groups).forEach((signals) => {
      signals.sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }, [availableSignals, activeSignals]);

  // Initialize expandedGroups with all source names when groups change
  useEffect(() => {
    setExpandedGroups(new Set(Object.keys(groupedBySource)));
  }, [groupedBySource]);

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedBySource;
    const q = searchQuery.toLowerCase();
    const filtered = {};
    for (const [source, signals] of Object.entries(groupedBySource)) {
      const matches = signals.filter(
        (sig) =>
          sig.name.toLowerCase().includes(q) ||
          source.toLowerCase().includes(q)
      );
      if (matches.length > 0) filtered[source] = matches;
    }
    return filtered;
  }, [groupedBySource, searchQuery]);

  // When searching, auto-expand all matching groups
  const displayExpandedGroups = useMemo(() => {
    if (searchQuery.trim()) {
      return new Set(Object.keys(filteredGroups));
    }
    return expandedGroups;
  }, [searchQuery, filteredGroups, expandedGroups]);

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

  const toggleGroup = (source) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

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

<<<<<<< HEAD
  const hasAvailableSignals = Object.keys(groupedAvailable).length > 0;
  const sortedGroupedEntries = useMemo(
    () => Object.entries(groupedAvailable).sort(([a], [b]) => a.localeCompare(b)),
    [groupedAvailable]
  );
=======
  const hasAvailableSignals = Object.keys(groupedBySource).length > 0;
>>>>>>> 259bc57ec5f41f20fc2786778acafee1712d5981

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
<<<<<<< HEAD
            {sortedGroupedEntries.map(([sender, signals]) => (
              <div key={sender} className="signal-dropdown-group">
                <div className="signal-dropdown-group-label">{sender}</div>
                {signals.map((sig) => (
=======
            <div className="signal-search-wrapper">
              <Search size={13} className="signal-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="signal-search-input"
                placeholder="Filter signals..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="signal-dropdown-list">
              {Object.keys(filteredGroups).length === 0 && (
                <div className="signal-dropdown-empty">No signals match</div>
              )}
              {Object.entries(filteredGroups).map(([source, signals]) => (
                <div key={source} className="signal-dropdown-group">
>>>>>>> 259bc57ec5f41f20fc2786778acafee1712d5981
                  <button
                    className="signal-dropdown-group-header"
                    onClick={() => toggleGroup(source)}
                  >
                    {displayExpandedGroups.has(source) ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                    <span className="signal-dropdown-group-label">
                      {source}
                    </span>
                    <span className="signal-dropdown-group-count">
                      {signals.length}
                    </span>
                  </button>
                  {displayExpandedGroups.has(source) &&
                    signals.map((sig) => (
                      <button
                        key={sig.name}
                        className="signal-dropdown-item"
                        onClick={() => handleAddSignal(sig)}
                      >
                        {sig.name}{" "}
                        <span className="signal-dropdown-unit">
                          ({sig.unit || "unknown"})
                        </span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
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
