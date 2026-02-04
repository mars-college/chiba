import { useState, useEffect, useCallback } from 'react';
import type { LightWithState, LightPreset, LightControlRequest, PresetLightSetting, DiscoveryResult } from '@chiba/shared';
import { apiGet, apiPost, apiDelete, apiPut } from '../hooks/useApi';
import { LightCard } from '../components/LightCard';
import { PresetCard } from '../components/PresetCard';
import { CreatePresetModal } from '../components/CreatePresetModal';
import { LightScheduleModal } from '../components/LightScheduleModal';

export function LightsPage() {
  const [lights, setLights] = useState<LightWithState[]>([]);
  const [presets, setPresets] = useState<LightPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreatePreset, setShowCreatePreset] = useState(false);
  const [controllingAll, setControllingAll] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [renamingLight, setRenamingLight] = useState<LightWithState | null>(null);
  const [newLightName, setNewLightName] = useState('');
  const [schedulingLight, setSchedulingLight] = useState<LightWithState | null>(null);

  const fetchLights = useCallback(async () => {
    try {
      const response = await apiGet<{ success: boolean; data: LightWithState[] }>('/lights');
      setLights(response.data || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch lights:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lights');
    }
  }, []);

  const fetchPresets = useCallback(async () => {
    try {
      const response = await apiGet<{ success: boolean; data: LightPreset[] }>('/presets');
      setPresets(response.data || []);
    } catch (err) {
      console.error('Failed to fetch presets:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchLights(), fetchPresets()]).finally(() => setLoading(false));
  }, [fetchLights, fetchPresets]);

  const handleControlLight = async (lightId: string, request: LightControlRequest) => {
    try {
      await apiPost(`/lights/${lightId}/control`, request);
      await fetchLights();
    } catch (err) {
      console.error('Failed to control light:', err);
      throw err;
    }
  };

  const handleControlAll = async (request: LightControlRequest) => {
    setControllingAll(true);
    try {
      await apiPost('/lights/all/control', request);
      await fetchLights();
    } catch (err) {
      console.error('Failed to control all lights:', err);
    } finally {
      setControllingAll(false);
    }
  };

  const handleApplyPreset = async (presetId: string) => {
    try {
      await apiPost(`/presets/${presetId}/apply`);
      await fetchLights();
    } catch (err) {
      console.error('Failed to apply preset:', err);
      throw err;
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    try {
      await apiDelete(`/presets/${presetId}`);
      await fetchPresets();
    } catch (err) {
      console.error('Failed to delete preset:', err);
      throw err;
    }
  };

  const handleCreatePreset = async (name: string, settings: PresetLightSetting[]) => {
    try {
      await apiPost('/presets', { name, settings });
      setShowCreatePreset(false);
      await fetchPresets();
    } catch (err) {
      console.error('Failed to create preset:', err);
      throw err;
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoveryResult(null);
    setError(null);
    try {
      const response = await apiPost<{ success: boolean; data: DiscoveryResult }>('/lights/discover', { timeout: 5000 });
      setDiscoveryResult(response.data);
      await fetchLights();
    } catch (err) {
      console.error('Failed to discover lights:', err);
      setError(err instanceof Error ? err.message : 'Failed to discover lights');
    } finally {
      setDiscovering(false);
    }
  };

  const handleRename = async () => {
    if (!renamingLight || !newLightName.trim()) return;
    try {
      await apiPut(`/lights/${renamingLight.id}`, { name: newLightName.trim() });
      setRenamingLight(null);
      setNewLightName('');
      await fetchLights();
    } catch (err) {
      console.error('Failed to rename light:', err);
      throw err;
    }
  };

  const handleDelete = async (lightId: string, lightName: string) => {
    if (!confirm(`Delete light "${lightName}"? This cannot be undone.`)) return;
    try {
      await apiDelete(`/lights/${lightId}`);
      await fetchLights();
    } catch (err) {
      console.error('Failed to delete light:', err);
      throw err;
    }
  };

  const openRenameModal = (light: LightWithState) => {
    setRenamingLight(light);
    setNewLightName(light.name);
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
          <h1 className="page-title">Lights</h1>
          <p className="page-subtitle">Control Govee LED lights</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-secondary"
            onClick={handleDiscover}
            disabled={discovering}
          >
            {discovering ? 'Scanning...' : 'Discover Lights'}
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
            onClick={() => handleControlAll({ power: true, brightness: 100 })}
            disabled={controllingAll}
          >
            {controllingAll ? '...' : 'All On'}
          </button>
        </div>
      </div>

      {discoveryResult && (
        <div className="alert alert-success" style={{ marginBottom: '24px' }}>
          Found {discoveryResult.discovered} light{discoveryResult.discovered !== 1 ? 's' : ''}.
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

      {/* Individual Lights */}
      <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>
        Individual Lights
      </h2>
      {lights.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </div>
          <h3 className="empty-state-title">No lights found</h3>
          <p className="empty-state-description">
            Click "Discover Lights" to scan for Govee lights on your network.
          </p>
        </div>
      ) : (
        <div className="node-grid">
          {lights.map((light) => (
            <LightCard
              key={light.id}
              light={light}
              onControl={(request) => handleControlLight(light.id, request)}
              onRename={() => openRenameModal(light)}
              onSchedule={() => setSchedulingLight(light)}
              onDelete={() => handleDelete(light.id, light.name)}
            />
          ))}
        </div>
      )}

      {/* Presets */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '32px', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Presets
        </h2>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowCreatePreset(true)}
        >
          Create Preset
        </button>
      </div>
      {presets.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px' }}>
          <p className="empty-state-description">
            No presets available. Create one to quickly apply settings.
          </p>
        </div>
      ) : (
        <div className="node-grid">
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onApply={() => handleApplyPreset(preset.id)}
              onDelete={preset.isPredefined ? undefined : () => handleDeletePreset(preset.id)}
            />
          ))}
        </div>
      )}

      {/* Create Preset Modal */}
      {showCreatePreset && (
        <CreatePresetModal
          lights={lights}
          onClose={() => setShowCreatePreset(false)}
          onCreate={handleCreatePreset}
        />
      )}

      {/* Schedule Light Modal */}
      {schedulingLight && (
        <LightScheduleModal
          light={schedulingLight}
          onClose={() => setSchedulingLight(null)}
        />
      )}

      {/* Rename Light Modal */}
      {renamingLight && (
        <div className="modal-overlay" onClick={() => setRenamingLight(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Rename Light</h2>
              <button className="modal-close" onClick={() => setRenamingLight(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={newLightName}
                  onChange={(e) => setNewLightName(e.target.value)}
                  placeholder="Enter light name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') setRenamingLight(null);
                  }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setRenamingLight(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRename}
                disabled={!newLightName.trim()}
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
