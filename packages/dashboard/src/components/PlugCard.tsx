import { useState, useEffect } from 'react';
import type { PlugWithState, PlugControlRequest } from '@chiba/shared';

interface PlugCardProps {
  plug: PlugWithState;
  onControl: (request: PlugControlRequest) => Promise<void>;
  onRename?: () => void;
  onSchedule?: () => void;
  onDelete?: () => void;
}

export function PlugCard({ plug, onControl, onRename, onSchedule, onDelete }: PlugCardProps) {
  const [isPowered, setIsPowered] = useState(plug.state?.power ?? false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (plug.state) {
      setIsPowered(plug.state.power);
    }
  }, [plug.state]);

  const handlePowerToggle = async () => {
    setIsLoading(true);
    try {
      await onControl({ power: !isPowered });
      setIsPowered(!isPowered);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 className="card-title" style={{ margin: 0 }}>{plug.name}</h3>
          {plug.model && (
            <span style={{
              fontSize: '0.75rem',
              padding: '2px 6px',
              background: 'var(--bg-secondary)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
            }}>
              {plug.model}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {onRename && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={onRename}
              title="Rename"
              style={{ padding: '4px 6px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          {onSchedule && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={onSchedule}
              title="Schedule"
              style={{ padding: '4px 6px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12,6 12,12 16,14" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              className="btn btn-sm"
              onClick={onDelete}
              title="Delete"
              style={{ padding: '4px 6px', backgroundColor: 'var(--error)', color: 'white' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3,6 5,6 21,6" />
                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="card-body">
        <div className="node-info-row">
          <span className="node-info-label">IP</span>
          <span className="node-info-value">{plug.ipAddress}</span>
        </div>
        <div className="node-info-row">
          <span className="node-info-label">Status</span>
          <span className="node-info-value" style={{ color: plug.reachable ? 'var(--success)' : 'var(--error)' }}>
            {plug.reachable ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
      <div className="card-footer" style={{ padding: '12px 16px' }}>
        <button
          className={`btn ${isPowered ? 'btn-primary' : 'btn-secondary'}`}
          onClick={handlePowerToggle}
          disabled={isLoading}
          style={{ width: '100%' }}
        >
          {isLoading ? 'Switching...' : isPowered ? 'Turn Off' : 'Turn On'}
        </button>
      </div>
    </div>
  );
}
