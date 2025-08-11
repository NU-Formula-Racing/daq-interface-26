import React, { useState } from 'react';

export default function Display({files}) {

    const [selected, setSelected] = useState(false)
    const [message, setMessage] = useState('')

    const loadDisplay = (file) => {
        if (Object.keys(file[0]).filter((key) => key.toLowerCase() === 'time (s)').length === 1) {
            setSelected(true)
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
        <div className={`mt-4 ${selected === true ? 'd-none' : ''}`}>
              <h6 className="upload-section-title">Uploaded CSV Files</h6>
              <div style={{ color: 'var(--muted, #6c757d)' }} className="small">{message}</div>

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
    )

    
    
}