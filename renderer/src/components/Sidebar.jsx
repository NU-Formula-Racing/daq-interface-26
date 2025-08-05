import React from 'react';

export default function Sidebar() {
    return (
        <div>
        <h4 className="mb-4">NFR 26 Dashboard</h4>
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
    )
}