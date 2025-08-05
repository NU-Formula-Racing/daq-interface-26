import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

export default function TableWindow() {
  const [csvData, setCsvData] = useState([]);

  useEffect(() => {
    window.expandFunction.onCsvData((data) => {
      setCsvData(data);
    });
  }, []);

  if (csvData.length === 0) return <div className="p-3">No data</div>;

  return (
    <div className="p-3">
      <h5>CSV File Preview</h5>
      <table className="table table-bordered table-sm">
        <thead>
          <tr>
            {Object.keys(csvData[0]).map((key, idx) => (
              <th key={idx}>{key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csvData.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {Object.values(row).map((val, colIdx) => (
                <td key={colIdx}>{val}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}