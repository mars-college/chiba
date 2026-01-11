import { useState } from 'react';
import type { LightPreset } from '@chiba/shared';

interface PresetCardProps {
  preset: LightPreset;
  onApply: () => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function PresetCard({ preset, onApply, onDelete }: PresetCardProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const appliesToAll = preset.settings.some((s) => s.lightId === '*');
  const lightCount = preset.settings.filter((s) => s.lightId !== '*').length;

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApply();
    } finally {
      setIsApplying(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  // Generate a preview of what the preset does
  const getPreview = () => {
    const setting = preset.settings[0];
    if (!setting) return null;

    if (setting.power === false) {
      return { label: 'Off', color: '#333' };
    }

    const h = setting.hue ?? 0;
    const s = setting.saturation ?? 100;
    const b = setting.brightness ?? 100;
    const l = (b / 100) * 50;

    return {
      label: `${b}%`,
      color: `hsl(${h}, ${s}%, ${l}%)`,
    };
  };

  const preview = getPreview();

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {preview && (
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                background: preview.color,
                border: '1px solid var(--border-color)',
              }}
            />
          )}
          <h3 className="card-title" style={{ margin: 0 }}>{preset.name}</h3>
        </div>
        {preset.isPredefined && (
          <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            System
          </span>
        )}
      </div>
      <div className="card-body" style={{ padding: '12px 16px' }}>
        <div className="node-info-row">
          <span className="node-info-label">Affects</span>
          <span className="node-info-value">
            {appliesToAll ? 'All lights' : `${lightCount} light(s)`}
          </span>
        </div>
      </div>
      <div className="card-footer" style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
        {onDelete && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleDelete}
            disabled={isDeleting || isApplying}
            style={{ flex: 1 }}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
        <button
          className="btn btn-primary btn-sm"
          onClick={handleApply}
          disabled={isApplying || isDeleting}
          style={{ flex: 1 }}
        >
          {isApplying ? 'Applying...' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
