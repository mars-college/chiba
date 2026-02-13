type VolumeHudProps = {
  volume: number;
  muted: boolean;
  visible: boolean;
};

export function VolumeHud({ volume, muted, visible }: VolumeHudProps) {
  const clamped = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
  const level = muted ? 0 : Math.round(clamped * 10);
  const percent = Math.round(clamped * 100);

  return (
    <div className={`volume-hud ${visible ? "is-visible" : ""}`}>
      <div className="volume-hud-header">
        <span>VOL</span>
        <span className="volume-hud-value">
          {muted ? "MUTED" : `${percent}%`}
        </span>
      </div>
      <div className="volume-bars" aria-hidden="true">
        {Array.from({ length: 10 }, (_, idx) => (
          <span
            key={idx}
            className={`volume-bar ${idx < level ? "is-on" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
