import React, { useState } from 'react';
import DashboardCanvas from './DashboardCanvas';


export default function Display({files}) {

    const [selected, setSelected] = useState(null)
    const [message, setMessage] = useState('')

    
    const layout = [
      { type:'gauge', span:12, ratio:3,
        props:{ title:'Main', value:65, valueSize:18, titleSize:16, showTitle:true, showTicks:true, barThickness:0.18 } },
    
      { type:'gauge', span:6, ratio:2,
        props:{ title:'Left', value:42, valueSize:14, titleSize:13, showTitle:true, showTicks:true } },
    
      { type:'gauge', span:6, ratio:2,
        props:{ title:'Right', value:78, valueSize:14, titleSize:13, showTitle:true, showTicks:true } },
    
      { type:'progress', span:4, height:70, props:{ label:'Speed', value:72, color:'#22c55e' } },
      { type:'progress', span:4, height:70, props:{ label:'Temp',  value:48, color:'#eab308', suffix:'°C' } },
      { type:'progress', span:4, height:70, props:{ label:'Pressure', value:31, color:'#3b82f6' } },
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
        const timeKey = getTimeKey(file)
        if (timeKey) {
            setSelected(file)
            setMessage('')
            return
        }
        else {
            setMessage('Please select a file that has a time column labeled \'Time\'')
            return
        }
    }

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
            <div className='mt-4'>
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
            <DashboardCanvas layout={layout} colWidth={78} gap={12} />
            </div>
          )}
        </div>
      );
    }