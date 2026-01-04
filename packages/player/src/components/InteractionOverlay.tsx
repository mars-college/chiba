interface InteractionOverlayProps {
  onInteract: () => void;
}

export function InteractionOverlay({ onInteract }: InteractionOverlayProps) {
  return (
    <div
      className="interaction-overlay"
      onClick={onInteract}
      onTouchStart={onInteract}
      onKeyDown={onInteract}
      tabIndex={0}
      role="button"
      aria-label="Click to enable playback"
    >
      <div className="interaction-content">
        <div className="interaction-icon">
          <svg
            width="80"
            height="80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <h2>Click to Enable Playback</h2>
        <p>Browser requires user interaction before playing media</p>
      </div>
    </div>
  );
}
