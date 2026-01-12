interface DownloadOverlayProps {
  progress: number;
  message?: string;
  name?: string;
}

/**
 * Download progress overlay shown during lazy-load playback.
 */
export function DownloadOverlay({ progress, message, name }: DownloadOverlayProps) {
  return (
    <div className="download-overlay">
      <div className="download-content">
        <div className="download-spinner" />
        {name && <h2 className="download-name">{name}</h2>}
        <div className="download-progress-bar">
          <div
            className="download-progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <p className="download-message">
          {message || `Downloading... ${Math.round(progress)}%`}
        </p>
      </div>
    </div>
  );
}
