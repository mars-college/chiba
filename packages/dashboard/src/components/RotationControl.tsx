import type { DisplayRotation } from '@chiba/shared';

interface RotationControlProps {
  rotation: DisplayRotation;
  disabled: boolean;
  onChange: (rotation: DisplayRotation) => void;
}

const ROTATION_OPTIONS: { value: DisplayRotation; label: string; icon: string }[] = [
  { value: 0, label: '0°', icon: '↑' },
  { value: 90, label: '90°', icon: '→' },
  { value: 180, label: '180°', icon: '↓' },
  { value: 270, label: '270°', icon: '←' },
];

export function RotationControl({ rotation, disabled, onChange }: RotationControlProps) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {ROTATION_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`btn ${rotation === option.value ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            style={{
              flex: '1 1 calc(50% - 4px)',
              minWidth: '80px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
            title={`Rotate display ${option.value} degrees`}
          >
            <span style={{ fontSize: '1.2em' }}>{option.icon}</span>
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      <p style={{
        marginTop: '12px',
        fontSize: '0.75rem',
        color: 'var(--text-secondary)',
        textAlign: 'center',
      }}>
        Rotation applies immediately and persists after reboot
      </p>
    </div>
  );
}
