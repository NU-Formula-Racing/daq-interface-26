import React, { useState } from 'react';
import DashboardCanvas from './DashboardCanvas';
import Slider from 'rc-slider';
import Tooltip from 'rc-tooltip';
import 'rc-slider/assets/index.css';
import 'rc-tooltip/assets/bootstrap.css';

export default function Display({ files }) {
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [sliderValue, setSliderValue] = useState(0);

  const layout = [
    // --- corner widgets (unchanged) ---
    { id:'corner-left',  type:'progress', col:1,  row:1, span:1, height:48, props:{ label:'WiFi',    value:90, color:'#22c55e', suffix:'%', showTicks:false } },
    { id:'corner-right', type:'progress', col:12, row:1, span:1, height:48, props:{ label:'Battery', value:76, color:'#16a34a', suffix:'%', showTicks:false } },
  
    // --- main gauge (unchanged) ---
    { id:'g-main', type:'gauge', col:3, row:1, span:8, rowSpan:4,
      props:{ title:'Main', value:selected !== null ? selected[sliderValue]["Speed (km/h)"] : 0, showTitle:true, showTicks:true, titleSize:16, valueSize:18, barThickness:0.18, max: 300 } },
  
      { id:'v-left',  type:'progress', col:2,  row:2, span:1, rowSpan:3,
        props:{ orientation:'vertical', label:'Coolant', value:55, color:'#3b82f6',
                suffix:'°C', thickness:16, showTicks:true, tickInterval:10, majorEvery:10 } },
      
      { id:'v-right', type:'progress', col:11, row:2, span:1, rowSpan:3,
        props:{ orientation:'vertical', label:'Fuel', value:76, color:'#22c55e',
                suffix:'%', thickness:16, showTicks:true, tickInterval:10, majorEvery:10 } },
  
    // --- four small gauges (unchanged, symmetric row under main) ---
    { id:'g-front-left',  type:'gauge', col:1,  row:5, span:3, rowSpan:2,
      props:{ title:'Left', value:42, showTitle:true, showTicks:true, titleSize:12, valueSize:12, barThickness:0.14 } },
    { id:'g-front-right', type:'gauge', col:4,  row:5, span:3, rowSpan:2,
      props:{ title:'Right', value:78, showTitle:true, showTicks:true, titleSize:12, valueSize:12, barThickness:0.14 } },
    { id:'g-rear-left',   type:'gauge', col:7,  row:5, span:3, rowSpan:2,
      props:{ title:'Rear Left', value:65, showTitle:true, showTicks:true, titleSize:12, valueSize:12, barThickness:0.14 } },
    { id:'g-rear-right',  type:'gauge', col:10, row:5, span:3, rowSpan:2,
      props:{ title:'Rear Right', value:78, showTitle:true, showTicks:true, titleSize:12, valueSize:12, barThickness:0.14 } },
  
    // --- progress bars (unchanged) ---
    { id:'p-throttle', type:'progress', col:3, row:7, span:3, height:56, props:{ label:'Throttle', value:72, color:'#22c55e' } },
    { id:'p-brake',    type:'progress', col:7, row:7, span:3, height:56, props:{ label:'Brake',    value:20, color:'#64748b' } },
    { id:'p-temp',     type:'progress', col:3, row:8, span:3, height:56, props:{ label:'Temp',     value:48, color:'#eab308', suffix:'°C' } },
    { id:'p-press',    type:'progress', col:7, row:8, span:3, height:56, props:{ label:'Pressure', value:31, color:'#3b82f6' } },
  ];

  const getTimeKey = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0] !== 'object') return null;
    const norm = (s) => String(s).normalize('NFKC').replace(/\u00A0/g, ' ').trim().toLowerCase();
    const keys = Object.keys(rows[0]);
    return keys.find(k => {
      const s = norm(k);
      return s === 'time' || s === 'time (s)' || s === 'time[s]';
    }) || null;
  };

  const loadDisplay = (file) => {
    const timeKey = getTimeKey(file);
    if (timeKey) {
      setSelected(file);
      setMessage('');
    } else {
      setMessage('Please select a file that has a time column labeled "Time"');
    }
  };

  if (files.length === 0) {
    return (
      <div style={{ color: 'var(--muted, #6c757d)' }} className="small">
        Please upload a file to activate display.
      </div>
    );
  }

  return (
    <div>
      {selected == null ? (
        <div className="mt-4">
          <h6 className="upload-section-title">Uploaded CSV Files</h6>
          {message && <div className="alert alert-warning py-2 my-2">{message}</div>}
          {files.map((file, index) => {
            const rows = Array.isArray(file.data) ? file.data.length : 0;
            const cols = rows ? Object.keys(file.data[0] ?? {}).length : 0;
            return (
              <div key={index} className="file-card mb-2">
                <div className="file-icon">📄</div>
                <div className="file-meta">
                  <div className="file-name" title={file.name}>{file.name}</div>
                  <div className="file-sub">{rows} rows • {cols} columns</div>
                </div>
                <div className="file-actions">
                  <button onClick={() => loadDisplay(file.data)} className="btn-ghost">
                    Select
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ color: 'var(--muted, #6c757d)' }} className="small">
          <button
            className="btn btn-sm btn-outline-secondary mb-3"
            onClick={() => setSelected(null)}
          >
            ← Back
          </button>
          <DashboardCanvas layout={layout} columns={12} colWidth={88} rowHeight={84} gap={6} />
          <Slider
          min={0}
          max={Math.max(0, selected.length - 1)}
          value={sliderValue}
          onChange={setSliderValue}
          handleRender={(node, handleProps) => (
            <Tooltip
              prefixCls="rc-tooltip"
              overlay={
                selected?.[handleProps.value]
                  ? `${Number(selected[handleProps.value]["Time (s)"]).toFixed(2)} s`
                  : ""
              }
              placement="top"
              visible={handleProps.dragging}
              key={handleProps.index}
            >
              {node}
            </Tooltip>
          )}
          style={{
            marginTop: '20px',
            width: '100%'
          }}
          railStyle={{ height: 10 }}
          trackStyle={{ height: 10 }}
          handleStyle={{
            height: 15,
            width: 15,
            marginTop: -3
          }}
        />
        </div>
      )}
    </div>
  );
}