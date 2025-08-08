// /renderer/src/components/Layout.jsx
import React, { useState } from 'react';
import Sidebar from './Sidebar';
import '../../../styles/Sidebar.css';

export default function Dashboard() {
  const [uploadStatus, setUploadStatus] = useState('');
  const [csvFiles, setCsvFiles] = useState([]);

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
      <div className="text-white p-3 d-flex flex-column sidebar" style={{ minWidth: 200, maxWidth: 200 }}>
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-fill p-4 tab-content" id="main">
        <div className="tab-pane fade show active" id="dashboard">
          <h5>Welcome to the Dashboard!</h5>
          <div className="mb-3">
            <button onClick={handleUpload} className="btn btn-primary">
              Upload CSV File
            </button>
          </div>
          <div className="text-muted small">{uploadStatus}</div>
          {csvFiles.length > 0 && Array.isArray(csvFiles[csvFiles.length - 1]) && csvFiles[csvFiles.length - 1].length > 0 && (
            <div className="mt-4">
                <h6>Preview of Last Uploaded File</h6>
                <div className="table-responsive">
                <table className="table table-bordered table-sm">
                    <thead>
                    <tr>
                        {Object.keys(csvFiles[csvFiles.length - 1][0]).map((key, index) => (
                        <th key={index}>{key}</th>
                        ))}
                    </tr>
                    </thead>
                    <tbody>
                    {csvFiles[csvFiles.length - 1].slice(0, 10).map((row, i) => (
                        <tr key={i}>
                        {Object.values(row).map((val, j) => (
                            <td key={j}>{val}</td>
                        ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
                </div>
            </div>
            )}
          {csvFiles.length > 0 && (
            <div className="mt-4">
              <h6>Uploaded CSV Files</h6>
              <ul className="list-group">
                {csvFiles.map((file, index) => (
                  <li key={index} className="list-group-item d-flex justify-content-between align-items-center">
                    <span>{file.name}</span>
                    <div>
                      <button onClick={() => window.expandFunction.openCsvWindow(file.data)} className="btn btn-sm btn-outline-primary me-2">
                        Expand
                      </button>
                      <button onClick={() => removeByIndex(index)} className="btn btn-sm btn-outline-danger">
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="tab-pane fade" id="charts">
          Charts will go here
        </div>
        <div className="tab-pane fade" id="table">
          Raw CSV Table here
        </div>
        <div className="tab-pane fade" id="settings">
          Settings go here
        </div>
      </div>
    </div>
  );
}