import React from 'react';
import '../../../styles/Sidebar.css';

export default function Sidebar({active, onTabChange}) {
    return (
      <div>
        <h4>NFR 26<br/>Dashboard</h4>
  
        <button className={`nav-btn ${active==='dashboard'?'active':''}`}
                onClick={()=>onTabChange('dashboard')}>Dashboard</button>
  
        <button className={`nav-btn ${active==='charts'?'active':''}`}
                onClick={()=>onTabChange('charts')}>Charts</button>
  
        <button className={`nav-btn ${active==='table'?'active':''}`}
                onClick={()=>onTabChange('table')}>Table View</button>
  
        <button className={`nav-btn ${active==='settings'?'active':''}`}
                onClick={()=>onTabChange('settings')}>Settings</button>
      </div>
    );
  }