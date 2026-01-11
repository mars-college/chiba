import { useState, useEffect } from 'react';
import type { LightWithState, LightControlRequest } from '@chiba/shared';

interface LightCardProps {
  light: LightWithState;
  onControl: (request: LightControlRequest) => Promise<void>;
}

export function LightCard({ light, onControl }: LightCardProps) {
  const [hue, setHue] = useState(light.state?.hue ?? 0);
  const [saturation, setSaturation] = useState(light.state?.saturation ?? 100);
  const [brightness, setBrightness] = useState(light.state?.brightness ?? 100);
  const [isPowered, setIsPowered] = useState(light.state?.power ?? false);
  const [isLoading, setIsLoading] = useState(false);

  // Sync with prop when light state changes
  useEffect(() => {
    if (light.state) {
      setHue(light.state.hue);
      setSaturation(light.state.saturation);
      setBrightness(light.state.brightness);
      setIsPowered(light.state.power);
    }
  }, [light.state]);

  const handlePowerToggle = async () => {
    setIsLoading(true);
    try {
      await onControl({ power: !isPowered });
      setIsPowered(!isPowered);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    setIsLoading(true);
    try {
      await onControl({ hue, saturation, brightness });
    } finally {
      setIsLoading(false);
    }
  };

  // Generate color preview
  const getPreviewColor = () => {
    if (!isPowered) return '#333';
    // Convert HSB to CSS hsl (saturation and lightness differ from HSB)
    // In CSS HSL: L=50% is full color, adjusted by saturation
    const l = (brightness / 100) * 50;
    return `hsl(${hue}, ${saturation}%, ${l}%)`;
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">{light.name}</h3>
        <button
          className={`btn btn-sm ${isPowered ? 'btn-primary' : 'btn-secondary'}`}
          onClick={handlePowerToggle}
          disabled={isLoading}
        >
          {isPowered ? 'On' : 'Off'}
        </button>
      </div>
      <div className="card-body">
        <div className="node-info-row">
          <span className="node-info-label">IP</span>
          <span className="node-info-value">{light.ipAddress}</span>
        </div>

        {/* Color preview */}
        <div
          style={{
            width: '100%',
            height: '40px',
            borderRadius: '8px',
            background: getPreviewColor(),
            opacity: isPowered ? 1 : 0.3,
            marginTop: '12px',
            marginBottom: '12px',
            border: '1px solid var(--border-color)',
          }}
        />

        {/* Hue slider */}
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Hue</span>
            <span style={{ color: 'var(--text-secondary)' }}>{hue}°</span>
          </label>
          <input
            type="range"
            min="0"
            max="360"
            value={hue}
            onChange={(e) => setHue(Number(e.target.value))}
            disabled={!isPowered || isLoading}
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

        {/* Saturation slider */}
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Saturation</span>
            <span style={{ color: 'var(--text-secondary)' }}>{saturation}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={saturation}
            onChange={(e) => setSaturation(Number(e.target.value))}
            disabled={!isPowered || isLoading}
            style={{ width: '100%' }}
          />
        </div>

        {/* Brightness slider */}
        <div className="form-group" style={{ marginBottom: '0' }}>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Brightness</span>
            <span style={{ color: 'var(--text-secondary)' }}>{brightness}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            disabled={!isPowered || isLoading}
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <div className="card-footer" style={{ padding: '12px 16px' }}>
        <button
          className="btn btn-primary"
          onClick={handleApply}
          disabled={!isPowered || isLoading}
          style={{ width: '100%' }}
        >
          {isLoading ? 'Applying...' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
