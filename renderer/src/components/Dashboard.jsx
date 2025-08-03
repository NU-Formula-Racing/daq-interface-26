// /renderer/src/components/Layout.jsx
import React, { useState } from 'react';

export default function Dashboard() {
  const [uploadStatus, setUploadStatus] = useState('');
  const [csvFiles, setCsvFiles] = useState([]);

  const handleUpload = async () => {
    const result = await window.fileUpload.openFile();
    if (result?.error) {
      setUploadStatus(result.error);
    } 
    else {
      setUploadStatus('CSV uploaded successfully!');
      setCsvFiles(prev => [...prev, result]);
      console.log(result);
    }
  };

  return (
    <div className="d-flex vh-100">
      {/* Sidebar */}
      <div className="bg-dark text-white p-3 d-flex flex-column" style={{ minWidth: 200, maxWidth: 200 }}>
        <h4 className="mb-4">NFR 26 Interface Dashboard</h4>
        <button className="btn btn-outline-light mb-2" data-bs-target="#dashboard" data-bs-toggle="tab">
          Dashboard
        </button>
        <button className="btn btn-outline-light mb-2" data-bs-target="#charts" data-bs-toggle="tab">
          Charts
        </button>
        <button className="btn btn-outline-light mb-2" data-bs-target="#table" data-bs-toggle="tab">
          Table View
        </button>
        <button className="btn btn-outline-light mb-2" data-bs-target="#settings" data-bs-toggle="tab">
          Settings
        </button>
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