import React from 'react';
import '../../../styles/Sidebar.css';

export default function Sidebar({active, onTabChange}) {
    return (
      <div>
        <h4>NFR 26<br/>Dashboard</h4>
  
        <button className={`nav-btn ${active==='dashboard'?'active':''}`}
                onClick={()=>onTabChange('dashboard')}>Dashboard</button>
  
        <button className={`nav-btn ${active==='display'?'active':''}`}
                onClick={()=>onTabChange('display')}>Display</button>
  
        <button className={`nav-btn ${active==='plot'?'active':''}`}
                onClick={()=>onTabChange('plot')}>Plot</button>
  
        <button className={`nav-btn ${active==='settings'?'active':''}`}
                onClick={()=>onTabChange('settings')}>Settings</button>
      </div>
    );
  }