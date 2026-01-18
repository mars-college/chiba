import { useState, useEffect } from 'react';
import type { LightWithState, LightControlRequest } from '@chiba/shared';

interface LightCardProps {
  light: LightWithState;
  onControl: (request: LightControlRequest) => Promise<void>;
  onRename?: () => void;
  onDelete?: () => void;
}

export function LightCard({ light, onControl, onRename, onDelete }: LightCardProps) {
  // Determine initial mode based on whether kelvin is set in state
  const initialMode = light.state?.kelvin ? 'temperature' : 'color';
  const [mode, setMode] = useState<'color' | 'temperature'>(initialMode);
  const [hue, setHue] = useState(light.state?.hue ?? 0);
  const [saturation, setSaturation] = useState(light.state?.saturation ?? 100);
  const [brightness, setBrightness] = useState(light.state?.brightness ?? 100);
  const [kelvin, setKelvin] = useState(light.state?.kelvin ?? 4000);
  const [isPowered, setIsPowered] = useState(light.state?.power ?? false);
  const [isLoading, setIsLoading] = useState(false);

  // Sync with prop when light state changes
  useEffect(() => {
    if (light.state) {
      setHue(light.state.hue);
      setSaturation(light.state.saturation);
      setBrightness(light.state.brightness);
      setIsPowered(light.state.power);
      if (light.state.kelvin) {
        setKelvin(light.state.kelvin);
        setMode('temperature');
      } else {
        setMode('color');
      }
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
      if (mode === 'temperature') {
        await onControl({ kelvin, brightness });
      } else {
        await onControl({ hue, saturation, brightness });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Convert kelvin to approximate RGB for preview
  const kelvinToRgb = (k: number): string => {
    // Attempt to approximate color temperature visually
    // 2000K = warm orange, 4000K = warm white, 5500K = daylight, 9000K = cool blue
    const temp = k / 100;
    let r: number, g: number, b: number;

    if (temp <= 66) {
      r = 255;
      g = Math.min(255, Math.max(0, 99.4708025861 * Math.log(temp) - 161.1195681661));
    } else {
      r = Math.min(255, Math.max(0, 329.698727446 * Math.pow(temp - 60, -0.1332047592)));
      g = Math.min(255, Math.max(0, 288.1221695283 * Math.pow(temp - 60, -0.0755148492)));
    }

    if (temp >= 66) {
      b = 255;
    } else if (temp <= 19) {
      b = 0;
    } else {
      b = Math.min(255, Math.max(0, 138.5177312231 * Math.log(temp - 10) - 305.0447927307));
    }

    // Apply brightness
    const br = brightness / 100;
    return `rgb(${Math.round(r * br)}, ${Math.round(g * br)}, ${Math.round(b * br)})`;
  };

  // Generate color preview
  const getPreviewColor = () => {
    if (!isPowered) return '#333';
    if (mode === 'temperature') {
      return kelvinToRgb(kelvin);
    }
    // Convert HSB to CSS hsl (saturation and lightness differ from HSB)
    // In CSS HSL: L=50% is full color, adjusted by saturation
    const l = (brightness / 100) * 50;
    return `hsl(${hue}, ${saturation}%, ${l}%)`;
  };

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 className="card-title" style={{ margin: 0 }}>{light.name}</h3>
          {light.sku && (
            <span style={{
              fontSize: '0.75rem',
              padding: '2px 6px',
              background: 'var(--bg-secondary)',
              borderRadius: '4px',
              color: 'var(--text-secondary)',
            }}>
              {light.sku}
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
          <button
            className={`btn btn-sm ${isPowered ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handlePowerToggle}
            disabled={isLoading}
          >
            {isPowered ? 'On' : 'Off'}
          </button>
        </div>
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

        {/* Mode toggle */}
        <div style={{
          display: 'flex',
          marginBottom: '12px',
          borderRadius: '6px',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
        }}>
          <button
            onClick={() => setMode('color')}
            disabled={!isPowered || isLoading}
            style={{
              flex: 1,
              padding: '6px 12px',
              border: 'none',
              background: mode === 'color' ? 'var(--color-primary)' : 'var(--bg-secondary)',
              color: mode === 'color' ? 'white' : 'var(--text-secondary)',
              cursor: isPowered ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem',
            }}
          >
            Color
          </button>
          <button
            onClick={() => setMode('temperature')}
            disabled={!isPowered || isLoading}
            style={{
              flex: 1,
              padding: '6px 12px',
              border: 'none',
              borderLeft: '1px solid var(--border-color)',
              background: mode === 'temperature' ? 'var(--color-primary)' : 'var(--bg-secondary)',
              color: mode === 'temperature' ? 'white' : 'var(--text-secondary)',
              cursor: isPowered ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem',
            }}
          >
            Temperature
          </button>
        </div>

        {mode === 'color' ? (
          <>
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
          </>
        ) : (
          /* Temperature slider */
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Temperature</span>
              <span style={{ color: 'var(--text-secondary)' }}>{kelvin}K</span>
            </label>
            <input
              type="range"
              min="2000"
              max="9000"
              step="100"
              value={kelvin}
              onChange={(e) => setKelvin(Number(e.target.value))}
              disabled={!isPowered || isLoading}
              style={{
                width: '100%',
                background: 'linear-gradient(to right, #ff9329, #fff5e6, #ffffff, #d4e4ff, #a6c8ff)',
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: 'var(--text-secondary)',
              marginTop: '2px',
            }}>
              <span>Warm</span>
              <span>Cool</span>
            </div>
          </div>
        )}

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
