import React from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js/lib/core';
import indicator from 'plotly.js/lib/indicator';
Plotly.register([indicator]);

const Plot = createPlotlyComponent(Plotly);

export default function AngularGauge({
  value = 65, min = 0, max = 100, title = 'Demo Gauge', units = '%',
  valueSize = 18, valueColor = '#cbd5e1', titleColor = '#94a3b8',
}) {
  const v = Math.min(max, Math.max(min, Number(value) || 0));
  return (
    <Plot
      data={[{
        type: 'indicator',
        mode: 'gauge+number',
        value: v,
        number: { suffix: units ? ` ${units}` : '', font: { size: valueSize, color: valueColor } },
        title: { text: title, font: { size: 12, color: titleColor } },
        gauge: {
          shape: 'angular',
          axis: { range: [min, max], ticks: '', tickwidth: 0, showticklabels: false },
          bar: { thickness: 0.14, color: '#16a34a' },
          steps: [
            { range: [min, min + 0.6*(max-min)], color: '#eaf3ff' },
            { range: [min + 0.6*(max-min), min + 0.85*(max-min)], color: '#fff2df' },
            { range: [min + 0.85*(max-min), max], color: '#fde8e8' },
          ],
          threshold: { value: v, line: { color: '#16a34a', width: 3 }, thickness: 0.75 },
        },
      }]}
      layout={{ margin: { l: 8, r: 8, t: 20, b: 0 }, paper_bgcolor: 'transparent' }}
      config={{ displayModeBar: false, displaylogo: false, responsive: true }}
      useResizeHandler
      style={{ width: '100%', height: '100%' }}
    />
  );
}