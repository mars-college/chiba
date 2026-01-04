import { useState, useEffect } from 'react';

interface VolumeControlProps {
  volume: number;
  disabled: boolean;
  onChange: (volume: number) => void;
}

export function VolumeControl({ volume, disabled, onChange }: VolumeControlProps) {
  const [localVolume, setLocalVolume] = useState(volume);
  const [isDragging, setIsDragging] = useState(false);

  // Sync with prop when not dragging
  useEffect(() => {
    if (!isDragging) {
      setLocalVolume(volume);
    }
  }, [volume, isDragging]);

  const handleChange = (newVolume: number) => {
    setLocalVolume(newVolume);
  };

  const handleCommit = () => {
    setIsDragging(false);
    if (localVolume !== volume) {
      onChange(localVolume);
    }
  };

  const getVolumeIcon = () => {
    if (localVolume === 0) {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      );
    }
    if (localVolume < 50) {
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      );
    }
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    );
  };

  const presets = [0, 25, 50, 75, 100];

  return (
    <div>
      <div className="volume-control">
        <span style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
          {getVolumeIcon()}
        </span>
        <input
          type="range"
          className="volume-slider"
          min="0"
          max="100"
          value={localVolume}
          onChange={(e) => handleChange(parseInt(e.target.value))}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={handleCommit}
          onTouchStart={() => setIsDragging(true)}
          onTouchEnd={handleCommit}
          disabled={disabled}
          style={{ flex: 1 }}
        />
        <span className="volume-value">{localVolume}%</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
        {presets.map((preset) => (
          <button
            key={preset}
            className={`btn btn-sm ${localVolume === preset ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setLocalVolume(preset);
              onChange(preset);
            }}
            disabled={disabled}
            style={{ flex: 1 }}
          >
            {preset}%
          </button>
        ))}
      </div>
    </div>
  );
}
