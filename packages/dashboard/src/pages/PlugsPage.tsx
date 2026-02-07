import { useState, useEffect, useCallback } from 'react';
import type { PlugWithState, PlugControlRequest, PlugDiscoveryResult } from '@chiba/shared';
import { apiGet, apiPost, apiDelete, apiPut } from '../hooks/useApi';
import { PlugCard } from '../components/PlugCard';
import { PlugScheduleModal } from '../components/PlugScheduleModal';

export function PlugsPage() {
  const [plugs, setPlugs] = useState<PlugWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [controllingAll, setControllingAll] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<PlugDiscoveryResult | null>(null);
  const [renamingPlug, setRenamingPlug] = useState<PlugWithState | null>(null);
  const [newPlugName, setNewPlugName] = useState('');
  const [schedulingPlug, setSchedulingPlug] = useState<PlugWithState | null>(null);
  const [subnet, setSubnet] = useState('');

  const fetchPlugs = useCallback(async () => {
    try {
      const response = await apiGet<{ success: boolean; data: PlugWithState[] }>('/plugs');
      setPlugs(response.data || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch plugs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch plugs');
    }
  }, []);

  useEffect(() => {
    fetchPlugs().finally(() => setLoading(false));
  }, [fetchPlugs]);

  const handleControlPlug = async (plugId: string, request: PlugControlRequest) => {
    try {
      await apiPost(`/plugs/${plugId}/control`, request);
      await fetchPlugs();
    } catch (err) {
      console.error('Failed to control plug:', err);
      throw err;
    }
  };

  const handleControlAll = async (request: PlugControlRequest) => {
    setControllingAll(true);
    try {
      await apiPost('/plugs/all/control', request);
      await fetchPlugs();
    } catch (err) {
      console.error('Failed to control all plugs:', err);
    } finally {
      setControllingAll(false);
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoveryResult(null);
    setError(null);
    try {
      const timeout = subnet ? 10000 : 5000;
      const response = await apiPost<{ success: boolean; data: PlugDiscoveryResult }>('/plugs/discover', {
        timeout,
        subnet: subnet || undefined,
      });
      setDiscoveryResult(response.data);
      await fetchPlugs();
    } catch (err) {
      console.error('Failed to discover plugs:', err);
      setError(err instanceof Error ? err.message : 'Failed to discover plugs');
    } finally {
      setDiscovering(false);
    }
  };

  const handleRename = async () => {
    if (!renamingPlug || !newPlugName.trim()) return;
    try {
      await apiPut(`/plugs/${renamingPlug.id}`, { name: newPlugName.trim() });
      setRenamingPlug(null);
      setNewPlugName('');
      await fetchPlugs();
    } catch (err) {
      console.error('Failed to rename plug:', err);
      throw err;
    }
  };

  const handleDelete = async (plugId: string, plugName: string) => {
    if (!confirm(`Delete plug "${plugName}"? This cannot be undone.`)) return;
    try {
      await apiDelete(`/plugs/${plugId}`);
      await fetchPlugs();
    } catch (err) {
      console.error('Failed to delete plug:', err);
      throw err;
    }
  };

  const openRenameModal = (plug: PlugWithState) => {
    setRenamingPlug(plug);
    setNewPlugName(plug.name);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Plugs</h1>
          <p className="page-subtitle">Control Kasa smart plugs</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            className="form-input"
            value={subnet}
            onChange={(e) => setSubnet(e.target.value)}
            placeholder="e.g. 100.128.0"
            style={{ width: '140px', height: '36px', fontSize: '13px' }}
          />
          <button
            className="btn btn-secondary"
            onClick={handleDiscover}
            disabled={discovering}
          >
            {discovering ? 'Scanning...' : 'Discover Plugs'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleControlAll({ power: false })}
            disabled={controllingAll}
          >
            {controllingAll ? '...' : 'All Off'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => handleControlAll({ power: true })}
            disabled={controllingAll}
          >
            {controllingAll ? '...' : 'All On'}
          </button>
        </div>
      </div>

      {discoveryResult && (
        <div className="alert alert-success" style={{ marginBottom: '24px' }}>
          Found {discoveryResult.discovered} plug{discoveryResult.discovered !== 1 ? 's' : ''}.
          {discoveryResult.added > 0 && ` Added ${discoveryResult.added} new.`}
          {discoveryResult.updated > 0 && ` Updated ${discoveryResult.updated}.`}
          <button
            style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setDiscoveryResult(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '24px' }}>
          {error}
        </div>
      )}

      {plugs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2v6m0 8v6" />
              <rect x="8" y="8" width="8" height="8" rx="1" />
              <path d="M10 8V5m4 3V5" />
            </svg>
          </div>
          <h3 className="empty-state-title">No plugs found</h3>
          <p className="empty-state-description">
            Click "Discover Plugs" to scan for Kasa smart plugs on your network.
          </p>
        </div>
      ) : (
        <div className="node-grid">
          {plugs.map((plug) => (
            <PlugCard
              key={plug.id}
              plug={plug}
              onControl={(request) => handleControlPlug(plug.id, request)}
              onRename={() => openRenameModal(plug)}
              onSchedule={() => setSchedulingPlug(plug)}
              onDelete={() => handleDelete(plug.id, plug.name)}
            />
          ))}
        </div>
      )}

      {/* Schedule Plug Modal */}
      {schedulingPlug && (
        <PlugScheduleModal
          plug={schedulingPlug}
          onClose={() => setSchedulingPlug(null)}
        />
      )}

      {/* Rename Plug Modal */}
      {renamingPlug && (
        <div className="modal-overlay" onClick={() => setRenamingPlug(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Rename Plug</h2>
              <button className="modal-close" onClick={() => setRenamingPlug(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={newPlugName}
                  onChange={(e) => setNewPlugName(e.target.value)}
                  placeholder="Enter plug name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') setRenamingPlug(null);
                  }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRenamingPlug(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRename}
                disabled={!newPlugName.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
