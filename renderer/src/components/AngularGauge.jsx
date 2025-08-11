import React from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js/lib/core';
import indicator from 'plotly.js/lib/indicator';
Plotly.register([indicator]);

const Plot = createPlotlyComponent(Plotly);

export default function AngularGauge({
  value = 65, min = 0, max = 100, title = 'Demo Gauge', 
  showTitle = true,
  showTicks = false,
  showNumber = true,
  titleSize = 14,
  valueSize = 18,
  units = '%',
  valueColor = '#cbd5e1',
  titleColor = '#94a3b8',
  tickColor = '#7a8794',
  tickSize = 10,
  barThickness = 0.16,
}) {
  const v = Math.min(max, Math.max(min, Number(value) || 0));
  return (
    <Plot
      data={[{
        type: 'indicator',
        mode: `gauge${showNumber ? '+number' : ''}`,
        value: v,
        number: showNumber ? {
          suffix: units ? ` ${units}` : '',
          font: { size: valueSize, color: valueColor }
        } : undefined,
        title: showTitle ? { text: title, font: { size: titleSize, color: titleColor } } : undefined,
        gauge: {
          shape: 'angular',
          axis: {
            range: [min, max],
            ticks: showTicks ? 'outside' : '',
            showticklabels: showTicks,
            tickfont: { size: tickSize, color: tickColor },
            ticklen: showTicks ? 4 : 0,
            tickwidth: showTicks ? 1 : 0,
          },
          bar: { thickness: barThickness, color: '#16a34a' },
          steps: [
            { range: [min, min + 0.6*(max-min)], color: '#eaf3ff' },
            { range: [min + 0.6*(max-min), min + 0.85*(max-min)], color: '#fff2df' },
            { range: [min + 0.85*(max-min), max], color: '#fde8e8' },
          ],
          threshold: { value: v, line: { color: '#16a34a', width: 3 }, thickness: 0.75 },
        },
        domain: { x: [0, 1], y: [0, 1] },
      }]}
      layout={{
        paper_bgcolor: 'transparent',
        margin: {
          l: 10,
          r: 10,
          t: showTitle ? Math.max(28, titleSize * 2) : 8,
          b: showNumber ? Math.max(24, valueSize * 1.2) : 6,
        },
      }}
      config={{ displayModeBar: false, displaylogo: false, responsive: true }}
      useResizeHandler
      style={{ width: '100%', height: '100%' }}
    />
  );
}