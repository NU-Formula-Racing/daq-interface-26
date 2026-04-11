import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Brush,
  ResponsiveContainer,
} from "recharts";
import { Download, ArrowLeft } from "lucide-react";
import { useSession } from "@/context/SessionContext";
import useIsMobile from "@/hooks/useIsMobile";
import { Slider } from "@/components/ui/slider";
import SignalPanel from "@/components/SignalPanel";
import "./Graphs.css";

const CHART_COLORS = [
  "#a78bfa",
  "#4ade80",
  "#f97316",
  "#38bdf8",
  "#fb7185",
  "#facc15",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

<<<<<<< HEAD
/** Derive available signals (name + unit + sender) from session data */
function deriveAvailableSignals(sessionData) {
  const map = new Map();
  for (const row of sessionData) {
    if (!map.has(row.signal_name)) {
      map.set(row.signal_name, {
        unit: row.unit || "unknown",
        sender: row.source || "unknown",
      });
    }
  }
  return Array.from(map.entries())
    .map(([name, meta]) => ({ name, unit: meta.unit, sender: meta.sender }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

=======
>>>>>>> 259bc57ec5f41f20fc2786778acafee1712d5981
/**
 * Pivot per-signal data arrays into Recharts-friendly rows:
 * [{ timestamp, signal1: val, signal2: val, ... }, ...]
 */
function pivotSignalData(signalDataMap) {
  const tsMap = new Map();
  for (const [signalName, rows] of signalDataMap.entries()) {
    for (const row of rows) {
      const key = row.timestamp;
      if (!tsMap.has(key)) {
        tsMap.set(key, { timestamp: key });
      }
      tsMap.get(key)[signalName] = Number(row.value);
    }
  }
  return Array.from(tsMap.values()).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, activeSignals }) {
  if (!active || !payload || payload.length === 0) return null;

  const ts = payload[0]?.payload?.timestamp;
  const sigMap = new Map(activeSignals.map((s) => [s.name, s]));

  return (
    <div className="graphs-tooltip">
      <div className="graphs-tooltip-time">{formatTime(ts)}</div>
      {payload.map((entry) => {
        const sig = sigMap.get(entry.dataKey);
        return (
          <div key={entry.dataKey} className="graphs-tooltip-row">
            <span
              className="graphs-tooltip-dot"
              style={{ background: sig?.color || entry.color }}
            />
            <span>{entry.dataKey}</span>
            <span className="graphs-tooltip-value">
              {entry.value != null ? Number(entry.value).toFixed(2) : "--"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cursor Value Readout
// ---------------------------------------------------------------------------

function CursorValueReadout({ cursorData, visibleSignals, replayTimestamp }) {
  if (!cursorData || !replayTimestamp) return null;

  return (
    <div className="graphs-cursor-readout">
      <span className="graphs-cursor-time">{formatTime(replayTimestamp)}</span>
      {visibleSignals.map((sig) => {
        const value = cursorData[sig.name];
        return (
          <span key={sig.name} className="graphs-cursor-value">
            <span
              className="graphs-cursor-dot"
              style={{ background: sig.color }}
            />
            {sig.name}: {value != null ? Number(value).toFixed(2) : "--"}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Chart
// ---------------------------------------------------------------------------

function MainChart({ chartData, activeSignals, unitAxes, replayTimestamp, cursorData, onBrushChange }) {
  const visibleSignals = activeSignals.filter((s) => s.visible);
  const hasThirdAxis = unitAxes.some((a) => a.isThirdAxis);

  if (visibleSignals.length === 0) {
    return (
      <div className="graphs-chart-empty">
        Select signals from the panel to begin analysis
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={chartData}
        margin={{
          top: 10,
          right: hasThirdAxis ? 80 : 20,
          left: 10,
          bottom: 5,
        }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(255,255,255,0.10)"
          vertical={false}
        />

        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          tick={{
            fill: "rgba(255,255,255,0.45)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
          stroke="rgba(255,255,255,0.14)"
          minTickGap={50}
        />

        {unitAxes.map((axis) => (
          <YAxis
            key={axis.yAxisId}
            yAxisId={axis.yAxisId}
            orientation={axis.orientation}
            mirror={axis.isThirdAxis || false}
            label={{
              value: axis.unit,
              angle: axis.orientation === "left" ? -90 : 90,
              position: "insideMiddle",
              fill: axis.color,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              dx: axis.isThirdAxis ? 50 : 0,
            }}
            tick={{
              fill: "rgba(255,255,255,0.45)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              dx: axis.isThirdAxis ? 50 : 0,
            }}
            stroke={axis.isThirdAxis ? "transparent" : "rgba(255,255,255,0.14)"}
            width={55}
          />
        ))}

        {visibleSignals.map((sig) => (
          <Line
            key={sig.name}
            type="monotone"
            dataKey={sig.name}
            yAxisId={sig.yAxisId}
            stroke={sig.color}
            dot={false}
            strokeWidth={2}
            connectNulls
            isAnimationActive={false}
          />
        ))}

        <Tooltip
          content={<ChartTooltip activeSignals={visibleSignals} />}
          cursor={{
            stroke: "rgba(255,255,255,0.3)",
            strokeDasharray: "4 4",
          }}
        />

        {replayTimestamp && (
          <ReferenceLine
            x={replayTimestamp}
            stroke="#4E2A84"
            strokeDasharray="4 4"
            strokeWidth={2}
          />
        )}

        {replayTimestamp && cursorData && visibleSignals.map((sig) => {
          const value = cursorData[sig.name];
          if (value == null) return null;
          return (
            <ReferenceDot
              key={`cursor-${sig.name}`}
              x={replayTimestamp}
              y={value}
              yAxisId={sig.yAxisId}
              r={5}
              fill={sig.color}
              stroke="rgba(255,255,255,0.8)"
              strokeWidth={1.5}
            />
          );
        })}

        <Brush
          dataKey="timestamp"
          height={30}
          stroke="#4E2A84"
          fill="rgba(10,10,15,0.95)"
          tickFormatter={formatTime}
          onChange={onBrushChange}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Timeline Slider
// ---------------------------------------------------------------------------

function TimelineSlider({ timestamps, replayPosition, setReplayPosition, mode }) {
  if (mode === "live") {
    return (
      <div className="graphs-timeline">
        <div className="graphs-timeline-live">
          LIVE &mdash; {formatTime(new Date().toISOString())}
        </div>
      </div>
    );
  }

  if (!timestamps || timestamps.length === 0) {
    return (
      <div className="graphs-timeline">
        <div className="graphs-timeline-label">No data</div>
      </div>
    );
  }

  const max = timestamps.length - 1;
  const currentIdx =
    replayPosition != null ? Math.min(replayPosition, max) : 0;
  const currentTs = timestamps[currentIdx] || timestamps[0];

  return (
    <div className="graphs-timeline">
      <div className="graphs-timeline-label">
        REPLAY &mdash; {formatTime(currentTs)}
      </div>
      <Slider
        min={0}
        max={max}
        value={[currentIdx]}
        onValueChange={([val]) => setReplayPosition(val)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graphs Page
// ---------------------------------------------------------------------------

export default function Graphs() {
  const {
    sessionId,
    selectedDate,
    mode,
    replayPosition,
    setReplayPosition,
    sessionSignals,
    fetchSignalDownsampled,
    fetchSignalWindow,
  } = useSession();

  const isMobile = useIsMobile();

  // Active signals state: [{ name, unit, color, visible, signal_id }]
  const [activeSignals, setActiveSignals] = useState([]);
  const [colorIndex, setColorIndex] = useState(0);
  const [brushRange, setBrushRange] = useState(null);

  // Per-signal data store: Map<signal_name, [{timestamp, value}]>
  const [signalDataMap, setSignalDataMap] = useState(new Map());

  // Available signals from session (from context's get_session_signals)
  const availableSignals = useMemo(
    () =>
      sessionSignals.map((s) => ({
        name: s.signal_name,
        unit: s.unit || "unknown",
        signal_id: s.signal_id,
        source: s.source,
      })),
    [sessionSignals]
  );

  // Fetch downsampled data when a signal is added
  const handleAddSignal = useCallback(
    async (signal) => {
      setActiveSignals((prev) => {
        if (prev.find((s) => s.name === signal.name)) return prev;
        return [
          ...prev,
          {
            name: signal.name,
            unit: signal.unit,
            color: CHART_COLORS[colorIndex % CHART_COLORS.length],
            visible: true,
            signal_id: signal.signal_id,
          },
        ];
      });
      setColorIndex((i) => i + 1);

      // Fetch data for this signal if not already loaded
      if (!signalDataMap.has(signal.name) && sessionId && signal.signal_id) {
        const data = await fetchSignalDownsampled(
          sessionId,
          signal.signal_id,
          1
        );
        setSignalDataMap((prev) => new Map(prev).set(signal.name, data));
      }
    },
    [colorIndex, signalDataMap, sessionId, fetchSignalDownsampled]
  );

  const handleRemoveSignal = useCallback((name) => {
    setActiveSignals((prev) => prev.filter((s) => s.name !== name));
    setSignalDataMap((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const handleToggleVisibility = useCallback((name) => {
    setActiveSignals((prev) =>
      prev.map((s) => (s.name === name ? { ...s, visible: !s.visible } : s))
    );
  }, []);

  // Clear signal data when session changes
  useEffect(() => {
    setActiveSignals([]);
    setSignalDataMap(new Map());
    setColorIndex(0);
    setBrushRange(null);
  }, [sessionId]);

  // Build overview chart data by pivoting per-signal data
  const overviewData = useMemo(
    () => pivotSignalData(signalDataMap),
    [signalDataMap]
  );

  // Zoom detail: fetch raw data when Brush selects a small window
  const [detailData, setDetailData] = useState(null);
  const brushDebounce = useRef(null);

  useEffect(() => {
    if (brushDebounce.current) clearTimeout(brushDebounce.current);

    if (!brushRange || !overviewData.length) {
      setDetailData(null);
      return;
    }

    const startTs = new Date(overviewData[brushRange.startIndex]?.timestamp).getTime();
    const endTs = new Date(overviewData[brushRange.endIndex]?.timestamp).getTime();
    const windowSec = (endTs - startTs) / 1000;

    if (windowSec > 30) {
      setDetailData(null);
      return;
    }

    const startIso = overviewData[brushRange.startIndex]?.timestamp;
    const endIso = overviewData[brushRange.endIndex]?.timestamp;

    const visibleSignals = activeSignals.filter((s) => s.visible);

    brushDebounce.current = setTimeout(async () => {
      // Fetch raw data for each visible signal in parallel
      const results = await Promise.all(
        visibleSignals.map(async (sig) => {
          const data = await fetchSignalWindow(
            sessionId,
            sig.signal_id,
            startIso,
            endIso
          );
          return [sig.name, data];
        })
      );

      const detailMap = new Map(results);
      setDetailData(pivotSignalData(detailMap));
    }, 300);

    return () => {
      if (brushDebounce.current) clearTimeout(brushDebounce.current);
    };
  }, [brushRange, overviewData, sessionId, activeSignals, fetchSignalWindow]);

  const chartData = detailData || overviewData;

  // CSV export for active + visible signals
  const handleGraphsCsvDownload = useCallback(() => {
    const visibleNames = activeSignals
      .filter((s) => s.visible)
      .map((s) => s.name);
    if (visibleNames.length === 0 || !chartData.length) return;

    const sortedNames = [...visibleNames].sort();
    const header = ["timestamp", ...sortedNames].join(",");

    const rows = chartData.map((point) => {
      const values = sortedNames.map((name) =>
        point[name] != null ? point[name] : ""
      );
      return [point.timestamp, ...values].join(",");
    });

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `NFR_Graphs_${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeSignals, chartData, selectedDate]);

  // Unique sorted timestamps for the slider
  const timestamps = useMemo(
    () => chartData.map((d) => d.timestamp),
    [chartData]
  );

  // Build Y-axis config: up to 3 unit types
  const unitAxes = useMemo(() => {
    const unitSet = new Map();
    for (const sig of activeSignals) {
      if (!sig.visible) continue;
      if (!unitSet.has(sig.unit)) {
        unitSet.set(sig.unit, sig.color);
      }
    }

    const axes = [];
    let idx = 0;
    for (const [unit, color] of unitSet.entries()) {
      const yAxisId = `y-${unit}`;

      if (idx === 0) {
        axes.push({ yAxisId, unit, orientation: "left", color });
      } else if (idx === 1) {
        axes.push({ yAxisId, unit, orientation: "right", color });
      } else if (idx === 2) {
        axes.push({
          yAxisId,
          unit,
          orientation: "right",
          color,
          isThirdAxis: true,
        });
      }

      idx++;
      if (idx >= 3) break;
    }

    return axes;
  }, [activeSignals]);

  // Map each active signal to its yAxisId
  const signalsWithAxis = useMemo(() => {
    const unitToAxis = new Map(unitAxes.map((a) => [a.unit, a.yAxisId]));
    return activeSignals.map((s) => ({
      ...s,
      yAxisId: unitToAxis.get(s.unit) || unitAxes[0]?.yAxisId || "y-default",
    }));
  }, [activeSignals, unitAxes]);

  // Replay reference line timestamp
  const replayTimestamp = useMemo(() => {
    if (mode !== "replay" || replayPosition == null) return null;
    return timestamps[replayPosition] || null;
  }, [mode, replayPosition, timestamps]);

  // Cursor data point for ReferenceDots and readout
  const cursorData = useMemo(() => {
    if (!replayTimestamp) return null;
    return chartData.find((d) => d.timestamp === replayTimestamp) || null;
  }, [chartData, replayTimestamp]);

  const visibleSignals = useMemo(
    () => signalsWithAxis.filter((s) => s.visible),
    [signalsWithAxis]
  );

  // Mode guard: redirect to /dashboard if in live mode
  if (mode === "live") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className={`graphs-page ${isMobile ? "graphs-page--mobile" : ""}`}>
      {/* Signal panel: on mobile appears above the chart */}
      {isMobile && (
        <div className="graphs-signal-panel-mobile">
          <SignalPanel
            availableSignals={availableSignals}
            activeSignals={signalsWithAxis}
            onAddSignal={handleAddSignal}
            onRemoveSignal={handleRemoveSignal}
            onToggleVisibility={handleToggleVisibility}
          />
        </div>
      )}

      <div className="graphs-main">
        {/* Back to Replay navigation */}
        <div className="graphs-back-nav">
          <Link to="/replay" className="graphs-back-link">
            <ArrowLeft size={16} />
            BACK TO REPLAY
          </Link>
        </div>
        <div className="graphs-chart-area">
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "0.25rem 0.5rem 0",
            }}
          >
            <button
              onClick={handleGraphsCsvDownload}
              title="Download visible signals as CSV"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "32px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.22)",
                borderRadius: "6px",
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
                transition: "border-color 0.2s ease, color 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
                e.currentTarget.style.color = "#f0f0f0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              }}
            >
              <Download size={16} />
            </button>
          </div>
          <MainChart
            chartData={chartData}
            activeSignals={signalsWithAxis}
            unitAxes={unitAxes}
            replayTimestamp={replayTimestamp}
            cursorData={cursorData}
            onBrushChange={setBrushRange}
          />
        </div>
        <CursorValueReadout
          cursorData={cursorData}
          visibleSignals={visibleSignals}
          replayTimestamp={replayTimestamp}
        />
        <TimelineSlider
          timestamps={timestamps}
          replayPosition={replayPosition}
          setReplayPosition={setReplayPosition}
          mode={mode}
        />
      </div>

      {/* Signal panel: on desktop appears on the right side */}
      {!isMobile && (
        <SignalPanel
          availableSignals={availableSignals}
          activeSignals={signalsWithAxis}
          onAddSignal={handleAddSignal}
          onRemoveSignal={handleRemoveSignal}
          onToggleVisibility={handleToggleVisibility}
        />
      )}
    </div>
  );
}
