import { useState } from 'react';
import type { LightWithState, PresetLightSetting } from '@chiba/shared';

interface CreatePresetModalProps {
  lights: LightWithState[];
  onClose: () => void;
  onCreate: (name: string, settings: PresetLightSetting[]) => Promise<void>;
}

export function CreatePresetModal({ lights, onClose, onCreate }: CreatePresetModalProps) {
  const [name, setName] = useState('');
  const [applyToAll, setApplyToAll] = useState(true);
  const [selectedLights, setSelectedLights] = useState<Set<string>>(new Set());
  const [power, setPower] = useState(true);
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleLight = (lightId: string) => {
    const newSelected = new Set(selectedLights);
    if (newSelected.has(lightId)) {
      newSelected.delete(lightId);
    } else {
      newSelected.add(lightId);
    }
    setSelectedLights(newSelected);
    // If selecting individual lights, disable "apply to all"
    if (newSelected.size > 0) {
      setApplyToAll(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    if (!applyToAll && selectedLights.size === 0) {
      setError('Select at least one light or choose "Apply to all"');
      return;
    }

    const settings: PresetLightSetting[] = [];

    if (applyToAll) {
      settings.push({
        lightId: '*',
        power,
        hue,
        saturation,
        brightness,
      });
    } else {
      for (const lightId of selectedLights) {
        settings.push({
          lightId,
          power,
          hue,
          saturation,
          brightness,
        });
      }
    }

    setIsCreating(true);
    try {
      await onCreate(name.trim(), settings);
    } catch (err) {
      setError((err as Error).message);
      setIsCreating(false);
    }
  };

  // Generate color preview
  const getPreviewColor = () => {
    if (!power) return '#333';
    const l = (brightness / 100) * 50;
    return `hsl(${hue}, ${saturation}%, ${l}%)`;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h3 className="modal-title">Create Preset</h3>
          <button className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="alert alert-error" style={{ marginBottom: '16px' }}>
                {error}
              </div>
            )}

            {/* Name */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Preset Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Evening Mood"
                autoFocus
              />
            </div>

            {/* Target lights */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Apply to</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={applyToAll}
                    onChange={(e) => {
                      setApplyToAll(e.target.checked);
                      if (e.target.checked) {
                        setSelectedLights(new Set());
                      }
                    }}
                  />
                  <span>All lights</span>
                </label>
                {lights.map((light) => (
                  <label
                    key={light.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      paddingLeft: '16px',
                      opacity: applyToAll ? 0.5 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedLights.has(light.id)}
                      onChange={() => toggleLight(light.id)}
                      disabled={applyToAll}
                    />
                    <span>{light.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Settings */}
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Settings</label>

              {/* Power toggle */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  marginBottom: '12px',
                }}
              >
                <input
                  type="checkbox"
                  checked={power}
                  onChange={(e) => setPower(e.target.checked)}
                />
                <span>Power On</span>
              </label>

              {/* Color preview */}
              <div
                style={{
                  width: '100%',
                  height: '32px',
                  borderRadius: '6px',
                  background: getPreviewColor(),
                  marginBottom: '12px',
                  border: '1px solid var(--border-color)',
                }}
              />

              {/* Hue */}
              <div style={{ marginBottom: '12px' }}>
                <label
                  className="form-label"
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}
                >
                  <span>Hue</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{hue}°</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={hue}
                  onChange={(e) => setHue(Number(e.target.value))}
                  disabled={!power}
                  style={{
                    width: '100%',
                    background: `linear-gradient(to right,
                      hsl(0, 100%, 50%),
                      hsl(60, 100%, 50%),
                      hsl(120, 100%, 50%),
                      hsl(180, 100%, 50%),
                      hsl(240, 100%, 50%),
                      hsl(300, 100%, 50%),
                      hsl(360, 100%, 50%))`,
                  }}
                />
              </div>

              {/* Saturation */}
              <div style={{ marginBottom: '12px' }}>
                <label
                  className="form-label"
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}
                >
                  <span>Saturation</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{saturation}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={saturation}
                  onChange={(e) => setSaturation(Number(e.target.value))}
                  disabled={!power}
                  style={{ width: '100%' }}
                />
              </div>

              {/* Brightness */}
              <div>
                <label
                  className="form-label"
                  style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}
                >
                  <span>Brightness</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{brightness}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  disabled={!power}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isCreating}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create Preset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
