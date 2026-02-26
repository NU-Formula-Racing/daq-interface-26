import { Settings } from 'lucide-react';
import './HudCard.css';

export default function HudCard({ title, children, className = '', onSettings }) {
  return (
    <div className={`hud-card hud-widget ${className}`}>
      <div className="hud-card-inner">
        <div className="hud-widget-header drag-handle">
          <span className="hud-widget-title">{title}</span>
          {onSettings && (
            <button
              className="hud-widget-settings"
              onClick={onSettings}
              onMouseDown={e => e.stopPropagation()}
            >
              <Settings size={14} />
            </button>
          )}
        </div>
        <div className="hud-widget-body">
          {children}
        </div>
      </div>
    </div>
  );
}
