import { useState, useCallback, useMemo } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from '@/context/SessionContext';
import useIsMobile from '@/hooks/useIsMobile';
import Sidebar from '@/widgets/Sidebar';
import HudCard from '@/components/HudCard';
import ConfigurableGauge from '@/widgets/ConfigurableGauge';
import BatteryTemp from '@/widgets/bars/BatteryTemp';
import MiniGraph from '@/widgets/MiniGraph';
import Readout from '@/widgets/Readout';
import StatusLight from '@/widgets/StatusLight';
import { Slider } from '@/components/ui/slider';
import { LayoutGrid, X, BarChart3 } from 'lucide-react';
import './Dash.css';
import './Replay.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import GridLayout, { WidthProvider } from 'react-grid-layout';

const ResponsiveGrid = WidthProvider(GridLayout);

const STORAGE_KEY = 'daqReplayWidgetLayout';

// ---------------------------------------------------------------------------
// Default widget layout — graph-focused for replay analysis
// ---------------------------------------------------------------------------
const DEFAULT_WIDGETS = [
  {
    i: 'mini-graph-1',
    type: 'mini-graph',
    x: 0, y: 0, w: 6, h: 4,
    config: {
      signals: [
        { name: 'IGBT_Temperature', color: '#a78bfa' },
        { name: 'Battery_Temperature', color: '#4ade80' },
      ],
      unit: '°C',
    },
  },
  {
    i: 'mini-graph-2',
    type: 'mini-graph',
    x: 6, y: 0, w: 6, h: 4,
    config: {
      signals: [
        { name: 'Inverter_RPM', color: '#f97316' },
      ],
      unit: 'RPM',
    },
  },
  {
    i: 'readout-1',
    type: 'readout',
    x: 0, y: 4, w: 4, h: 2,
    config: { signalName: 'Inverter_RPM', unit: 'RPM' },
  },
  {
    i: 'gauge-1',
    type: 'gauge',
    x: 4, y: 4, w: 4, h: 3,
    config: { signalName: 'IGBT_Temperature', unit: '°C', min: 0, max: 120 },
  },
];

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
function loadWidgets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore corrupt data
  }
  return DEFAULT_WIDGETS;
}

function saveWidgets(widgets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
}

const WIDGET_LABELS = {
  'gauge':        'Gauge',
  'bar-meter':    'Bar Meter',
  'mini-graph':   'Mini Graph',
  'readout':      'Readout',
  'status-light': 'Status Light',
};

const MOBILE_WIDGET_HEIGHTS = {
  'gauge':        '300px',
  'bar-meter':    '300px',
  'mini-graph':   '300px',
  'readout':      '200px',
  'status-light': '200px',
};

function getWidgetTitle(widget) {
  if (widget.config?.title) return widget.config.title;
  const base = WIDGET_LABELS[widget.type] ?? widget.type;
  const signal = widget.config?.signalName || '';
  return signal ? `${base} \u2014 ${signal}` : base;
}

// ---------------------------------------------------------------------------
// Replay Page
// ---------------------------------------------------------------------------
export default function Replay() {
  const {
    mode,
    replaySessionData,
    replayPosition,
    setReplayPosition,
  } = useSession();

  const isMobile = useIsMobile();
  const [widgets, setWidgets] = useState(loadWidgets);
  const [configWidgetId, setConfigWidgetId] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Round to nearest second so signals at slightly different ms group together
  // -------------------------------------------------------------------------
  const roundTs = (ts) =>
    new Date(Math.round(new Date(ts).getTime() / 1000) * 1000).toISOString();

  // -------------------------------------------------------------------------
  // Unique timestamps for replay scrubber (rounded to nearest second)
  // -------------------------------------------------------------------------
  const uniqueTimestamps = useMemo(() => {
    if (!replaySessionData.length) return [];
    return [...new Set(replaySessionData.map(d => roundTs(d.timestamp)))].sort();
  }, [replaySessionData]);

  // -------------------------------------------------------------------------
  // Signal lookup index for O(1) replay resolution (keyed by rounded ts)
  // -------------------------------------------------------------------------
  const signalIndex = useMemo(() => {
    const map = new Map();
    for (const d of replaySessionData) {
      map.set(`${d.signal_name}::${roundTs(d.timestamp)}`, d);
    }
    return map;
  }, [replaySessionData]);

  // -------------------------------------------------------------------------
  // Available signal names from replay data
  // -------------------------------------------------------------------------
  const availableSignals = useMemo(() => {
    const names = new Set();
    for (const d of replaySessionData) {
      names.add(d.signal_name);
    }
    return [...names].sort();
  }, [replaySessionData]);

  // -------------------------------------------------------------------------
  // Signal value resolution (replay only)
  // -------------------------------------------------------------------------
  const resolveValue = useCallback((signalName) => {
    if (!signalName) return { value: 0, previousValue: null };

    if (!replaySessionData.length || replayPosition == null) {
      return { value: 0, previousValue: null };
    }

    const currentTs = uniqueTimestamps[replayPosition];
    if (!currentTs) return { value: 0, previousValue: null };

    const match = signalIndex.get(`${signalName}::${currentTs}`);

    let previousValue = null;
    if (replayPosition > 0) {
      const prevTs = uniqueTimestamps[replayPosition - 1];
      const prevMatch = signalIndex.get(`${signalName}::${prevTs}`);
      previousValue = prevMatch?.value ?? null;
    }

    return { value: match?.value ?? 0, previousValue };
  }, [replaySessionData, replayPosition, uniqueTimestamps, signalIndex]);

  // -------------------------------------------------------------------------
  // Widget CRUD
  // -------------------------------------------------------------------------
  const handleAddWidget = useCallback((type) => {
    const id = `${type}-${Date.now()}`;
    const defaultConfigs = {
      'gauge':        { signalName: 'Inverter_RPM', unit: 'RPM', min: 0, max: 8000 },
      'bar-meter':    { signalName: 'Battery_Temperature' },
      'mini-graph':   { signals: [{ name: 'Inverter_RPM', color: '#a78bfa' }], unit: '' },
      'readout':      { signalName: 'Inverter_RPM', unit: 'RPM' },
      'status-light': { signalName: 'Battery_Temperature', threshold: 50, unit: '°C' },
    };

    setWidgets(prev => [
      ...prev,
      {
        i: id,
        type,
        x: 0,
        y: Infinity,
        w: type === 'bar-meter' ? 2 : type === 'status-light' || type === 'readout' ? 3 : 4,
        h: type === 'bar-meter' ? 4 : type === 'status-light' || type === 'readout' ? 2 : 3,
        config: defaultConfigs[type] ?? {},
      },
    ]);
  }, []);

  const handleRemoveWidget = useCallback((widgetId) => {
    setWidgets(prev => prev.filter(w => w.i !== widgetId));
  }, []);

  const handleLayoutChange = useCallback((newLayout) => {
    setWidgets(prev =>
      prev.map(widget => {
        const item = newLayout.find(l => l.i === widget.i);
        if (!item) return widget;
        return { ...widget, x: item.x, y: item.y, w: item.w, h: item.h };
      })
    );
  }, []);

  const handleSaveLayout = useCallback(() => {
    saveWidgets(widgets);
  }, [widgets]);

  const handleResetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setWidgets(DEFAULT_WIDGETS);
  }, []);

  // -------------------------------------------------------------------------
  // Config modal
  // -------------------------------------------------------------------------
  const configWidget = configWidgetId ? widgets.find(w => w.i === configWidgetId) : null;

  const handleConfigSave = useCallback((widgetId, newConfig) => {
    setWidgets(prev =>
      prev.map(w => w.i === widgetId ? { ...w, config: { ...w.config, ...newConfig } } : w)
    );
    setConfigWidgetId(null);
  }, []);

  // -------------------------------------------------------------------------
  // Widget rendering
  // -------------------------------------------------------------------------
  const renderWidget = useCallback((widget) => {
    const { config } = widget;

    switch (widget.type) {
      case 'gauge': {
        const { value } = resolveValue(config.signalName);
        return (
          <ConfigurableGauge
            signalName={config.signalName}
            value={value}
            unit={config.unit ?? ''}
            min={config.min ?? 0}
            max={config.max ?? 100}
          />
        );
      }

      case 'bar-meter': {
        const { value } = resolveValue(config.signalName);
        return <BatteryTemp temperature={value} />;
      }

      case 'mini-graph': {
        return (
          <MiniGraph
            signals={config.signals ?? []}
            unit={config.unit ?? ''}
            sessionData={replaySessionData}
            mode="replay"
            replayPosition={replayPosition}
          />
        );
      }

      case 'readout': {
        const { value, previousValue } = resolveValue(config.signalName);
        return (
          <Readout
            signalName={config.signalName}
            value={value}
            unit={config.unit ?? ''}
            previousValue={previousValue}
          />
        );
      }

      case 'status-light': {
        const { value } = resolveValue(config.signalName);
        return (
          <StatusLight
            signalName={config.signalName}
            value={value}
            threshold={config.threshold ?? 50}
            unit={config.unit ?? ''}
          />
        );
      }

      default:
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
            color: 'rgba(224,230,237,0.5)',
          }}>
            Unknown widget type
          </div>
        );
    }
  }, [resolveValue, replaySessionData, replayPosition]);

  // Layout for react-grid-layout
  const layout = useMemo(() => widgets.map(w => ({
    i: w.i, x: w.x, y: w.y, w: w.w, h: w.h,
  })), [widgets]);

  // Current replay timestamp display
  const currentTimestamp = useMemo(() => {
    if (replayPosition == null || !uniqueTimestamps.length) return null;
    const ts = uniqueTimestamps[replayPosition];
    if (!ts) return null;
    try {
      return new Date(ts).toLocaleTimeString('en-US', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
      }) + '.' + String(new Date(ts).getMilliseconds()).padStart(3, '0');
    } catch {
      return ts;
    }
  }, [replayPosition, uniqueTimestamps]);

  // Mode guard: redirect to /dashboard if live
  if (mode === 'live') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="dashboard-container">
      {/* Desktop sidebar */}
      {!isMobile && (
        <Sidebar
          widgets={widgets}
          onAddWidget={handleAddWidget}
          onRemoveWidget={handleRemoveWidget}
          onSaveLayout={handleSaveLayout}
          onResetLayout={handleResetLayout}
        />
      )}

      <div className="dashboard-main">
        {/* Detailed Analysis link */}
        <div className="replay-analysis-bar">
          <Link to="/graphs" className="replay-analysis-link">
            <BarChart3 size={16} />
            DETAILED ANALYSIS
          </Link>
        </div>

        {/* Grid Area */}
        <div className="dashboard-grid-area">
          {isMobile ? (
            <div className="dashboard-mobile-stack">
              {widgets.map((widget, index) => (
                <motion.div
                  key={widget.i}
                  className="widget-container widget-container--mobile"
                  style={{ height: MOBILE_WIDGET_HEIGHTS[widget.type] || '300px' }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: 'easeOut', delay: 0.15 + Math.min(index * 0.08, 0.4) }}
                >
                  <HudCard
                    title={getWidgetTitle(widget)}
                    onSettings={() => setConfigWidgetId(widget.i)}
                  >
                    {renderWidget(widget)}
                  </HudCard>
                </motion.div>
              ))}
            </div>
          ) : (
            <ResponsiveGrid
              className="layout"
              layout={layout}
              onLayoutChange={handleLayoutChange}
              cols={12}
              rowHeight={100}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
            >
              {widgets.map((widget, index) => (
                <div key={widget.i} className="widget-container">
                  <motion.div
                    style={{ height: '100%' }}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: 'easeOut', delay: 0.15 + Math.min(index * 0.08, 0.4) }}
                  >
                    <HudCard
                      title={getWidgetTitle(widget)}
                      onSettings={() => setConfigWidgetId(widget.i)}
                    >
                      {renderWidget(widget)}
                    </HudCard>
                  </motion.div>
                </div>
              ))}
            </ResponsiveGrid>
          )}
        </div>

        {/* Replay Scrubber — always visible */}
        {uniqueTimestamps.length > 0 && (
          <div className={`replay-scrubber ${isMobile ? 'replay-scrubber--mobile' : ''}`}>
            <div className="replay-scrubber-timestamp">
              {currentTimestamp ?? '--:--:--'}
            </div>
            <Slider
              value={[replayPosition ?? 0]}
              onValueChange={(v) => setReplayPosition(v[0])}
              min={0}
              max={Math.max(uniqueTimestamps.length - 1, 0)}
              step={1}
            />
          </div>
        )}
      </div>

      {/* Mobile floating sidebar toggle */}
      {isMobile && (
        <button
          className="dashboard-mobile-sidebar-toggle"
          onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
          aria-label="Toggle widget sidebar"
        >
          {mobileSidebarOpen ? <X size={22} /> : <LayoutGrid size={22} />}
        </button>
      )}

      {/* Mobile sidebar overlay (bottom sheet) */}
      <AnimatePresence>
        {isMobile && mobileSidebarOpen && (
          <>
            <motion.div
              className="dashboard-mobile-overlay"
              onClick={() => setMobileSidebarOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            />
            <motion.div
              className="dashboard-mobile-sidebar"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Sidebar
                widgets={widgets}
                onAddWidget={handleAddWidget}
                onRemoveWidget={handleRemoveWidget}
                onSaveLayout={handleSaveLayout}
                onResetLayout={handleResetLayout}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Config Modal */}
      <AnimatePresence>
        {configWidget && (
          <ConfigModal
            key={configWidget.i}
            widget={configWidget}
            availableSignals={availableSignals}
            onSave={(newConfig) => handleConfigSave(configWidget.i, newConfig)}
            onCancel={() => setConfigWidgetId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config Modal Component (same as Dashboard)
// ---------------------------------------------------------------------------
const SIGNAL_COLORS = ['#a78bfa', '#4ade80', '#f97316', '#38bdf8', '#fb7185'];

function ConfigModal({ widget, availableSignals = [], onSave, onCancel }) {
  const [config, setConfig] = useState({ ...widget.config });

  const updateField = (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(config);
  };

  const needsSignalName = ['gauge', 'bar-meter', 'readout', 'status-light'].includes(widget.type);
  const needsMinMax = widget.type === 'gauge';
  const needsThreshold = widget.type === 'status-light';
  const needsUnit = ['gauge', 'readout', 'status-light'].includes(widget.type);
  const needsSignals = widget.type === 'mini-graph';

  // For mini-graph: which signals are currently selected
  const selectedSignalNames = new Set((config.signals ?? []).map(s => s.name));

  const toggleSignal = (name) => {
    const current = config.signals ?? [];
    if (selectedSignalNames.has(name)) {
      updateField('signals', current.filter(s => s.name !== name));
    } else {
      const idx = current.length;
      updateField('signals', [...current, { name, color: SIGNAL_COLORS[idx % SIGNAL_COLORS.length] }]);
    }
  };

  return (
    <motion.div
      className="config-modal-overlay"
      onClick={onCancel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.form
        className="config-modal"
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
      >
        <h3>Configure Widget</h3>

        {needsSignalName && (
          <>
            <label>Signal</label>
            <select
              value={config.signalName ?? ''}
              onChange={e => updateField('signalName', e.target.value)}
            >
              <option value="" disabled>Select a signal</option>
              {availableSignals.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </>
        )}

        {needsUnit && (
          <>
            <label>Unit</label>
            <input
              type="text"
              value={config.unit ?? ''}
              onChange={e => updateField('unit', e.target.value)}
              placeholder="e.g. RPM, °C"
            />
          </>
        )}

        {needsMinMax && (
          <>
            <label>Min Value</label>
            <input
              type="number"
              value={config.min ?? 0}
              onChange={e => updateField('min', Number(e.target.value))}
            />
            <label>Max Value</label>
            <input
              type="number"
              value={config.max ?? 100}
              onChange={e => updateField('max', Number(e.target.value))}
            />
          </>
        )}

        {needsThreshold && (
          <>
            <label>Threshold</label>
            <input
              type="number"
              value={config.threshold ?? 50}
              onChange={e => updateField('threshold', Number(e.target.value))}
            />
          </>
        )}

        {needsSignals && (
          <>
            <label>Title</label>
            <input
              type="text"
              value={config.title ?? ''}
              onChange={e => updateField('title', e.target.value)}
              placeholder="e.g. Engine Temps"
            />
            <label>Signals</label>
            <div className="config-signal-list">
              {availableSignals.length === 0 ? (
                <div style={{
                  padding: '12px',
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  color: 'rgba(255,255,255,0.45)',
                }}>
                  No signals available
                </div>
              ) : (
                availableSignals.map(name => {
                  const isActive = selectedSignalNames.has(name);
                  const signal = (config.signals ?? []).find(s => s.name === name);
                  return (
                    <div
                      key={name}
                      className={`config-signal-item ${isActive ? 'config-signal-item--active' : ''}`}
                      onClick={() => toggleSignal(name)}
                    >
                      <span
                        className={`config-signal-dot ${isActive ? 'config-signal-dot--active' : ''}`}
                        style={isActive ? { background: signal?.color ?? '#a78bfa' } : undefined}
                      />
                      {name}
                    </div>
                  );
                })
              )}
            </div>
            <label>Unit</label>
            <input
              type="text"
              value={config.unit ?? ''}
              onChange={e => updateField('unit', e.target.value)}
              placeholder="e.g. RPM"
            />
          </>
        )}

        <div className="config-modal-actions">
          <button type="button" className="config-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="config-modal-save">
            Save
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
