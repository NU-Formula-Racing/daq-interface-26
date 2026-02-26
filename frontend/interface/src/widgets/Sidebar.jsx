import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ChevronDown } from 'lucide-react';
import './Sidebar.css';

const WIDGET_TYPES = [
  { type: 'gauge',        label: 'Configurable Gauge' },
  { type: 'bar-meter',    label: 'Battery/Temp Bar' },
  { type: 'mini-graph',   label: 'Mini Graph' },
  { type: 'readout',      label: 'Readout' },
  { type: 'status-light', label: 'Status Light' },
];

export default function Sidebar({ widgets, onAddWidget, onRemoveWidget, onSaveLayout, onResetLayout }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const handleAddWidget = (type) => {
    onAddWidget(type);
    setDropdownOpen(false);
  };

  const getLabelForType = (type) => {
    return WIDGET_TYPES.find(w => w.type === type)?.label ?? type;
  };

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <h2 className="sidebar-title">Widgets</h2>

        {/* Add Widget Button + Dropdown */}
        <div className="sidebar-add-wrapper" ref={dropdownRef}>
          <button
            className="sidebar-add-btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <Plus size={14} />
            Add Widget
            <ChevronDown size={12} style={{
              transform: dropdownOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }} />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                className="sidebar-dropdown"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
              >
                {WIDGET_TYPES.map(w => (
                  <button
                    key={w.type}
                    className="sidebar-dropdown-item"
                    onClick={() => handleAddWidget(w.type)}
                  >
                    {w.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Active Widgets List */}
      <div className="sidebar-widgets">
        {widgets.length === 0 ? (
          <div className="sidebar-empty">
            No widgets added.<br />
            Click &quot;Add Widget&quot; to get started.
          </div>
        ) : (
          widgets.map(widget => (
            <div key={widget.i} className="sidebar-widget-item">
              <div className="sidebar-widget-item-header">
                <span className="sidebar-widget-type">
                  {widget.config?.title || getLabelForType(widget.type)}
                </span>
                <button
                  className="sidebar-remove-btn"
                  onClick={() => onRemoveWidget(widget.i)}
                >
                  Remove
                </button>
              </div>
              {widget.config?.signalName && (
                <span className="sidebar-widget-signal">
                  {widget.config.signalName}
                </span>
              )}
              {widget.config?.signals?.length > 0 && (
                <span className="sidebar-widget-signal">
                  {widget.config.signals.map(s => s.name).join(', ')}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <button className="sidebar-save-btn" onClick={onSaveLayout}>
          Save Layout
        </button>
        <button className="sidebar-reset-btn" onClick={onResetLayout}>
          Reset Layout
        </button>
      </div>
    </div>
  );
}
