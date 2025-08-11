// /renderer/src/components/Layout.jsx
import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Display from './Display';
import '../../../styles/Sidebar.css';
import '../../../styles/list.css';

export default function Dashboard() {
  const [uploadStatus, setUploadStatus] = useState('');
  const [csvFiles, setCsvFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const last = csvFiles.at(-1);
  const lastData = Array.isArray(last?.data) ? last.data : null;

  const handleUpload = async () => {
    const result = await window.fileUpload.openFile();
    if (result?.error) {
      setUploadStatus(result.error);
    }
    else if (result === null) {
      return
    } 
    else {
      for (let i = 0; i < csvFiles.length; i++) {
        if (csvFiles[i].name.toLowerCase() === result.name.toLowerCase()) {
          setUploadStatus('Cannot add the same CSV file.')
          return
        }
      }
      setUploadStatus('CSV uploaded successfully!');
      setCsvFiles(prev => [...prev, result]);
      console.log(result);
    }
  };

  const removeByIndex = (indexToRemove) => {
    setCsvFiles(prev => prev.filter((_, i) => i !== indexToRemove));
  };

  return (
    <div className="d-flex vh-100">
      {/* Sidebar */}
      <div className="sidebar" style={{ minWidth: 260, maxWidth: 260 }}>
        <Sidebar active={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Main content */}
      <div className="flex-fill p-4 tab-content" id="main">
        <div className={`tab-pane fade ${activeTab ==='dashboard' ? 'show active' : ''}`} id="dashboard">
          <h5>Welcome to the Dashboard!</h5>
          <div className="mb-3">
            <button onClick={handleUpload} className="btn btn-primary">
              Upload CSV File
            </button>
          </div>
          <div style={{color:'var(--muted)'}} className="small">{uploadStatus}</div>
          {csvFiles.length > 0 && (
            <div className="mt-4">
              <h6 className="upload-section-title">Uploaded CSV Files</h6>

              {csvFiles.map((file, index) => {
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
                      <button
                        onClick={() => window.expandFunction.openCsvWindow(file.data)}
                        className="btn-ghost"
                      >
                        Expand
                      </button>
                      <button
                        onClick={() => removeByIndex(index)}
                        className="btn-danger-soft"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className={`tab-pane fade ${activeTab === 'display' ? 'show active' : ''}`} id="display">
          <Display files={csvFiles} />
        </div>
        <div className={`tab-pane fade ${activeTab === 'plot' ? 'show active' : ''}`} id="plot">
          Plots will go here.
        </div>
        <div className={`tab-pane fade ${activeTab === 'settings' ? 'show active' : ''}`} id="settings">
          Settings will go here.
        </div>
      </div>
    </div>
  );
}