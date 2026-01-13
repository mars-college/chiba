interface DownloadOverlayProps {
  progress: number;
  message?: string;
  name?: string;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Download progress overlay shown during lazy-load playback.
 */
export function DownloadOverlay({ progress, message, name }: DownloadOverlayProps) {
  const displayName = name ? truncate(name, 250) : undefined;

  return (
    <div className="download-overlay">
      <div className="download-content">
        <div className="download-spinner" />
        {displayName && <h2 className="download-name">{displayName}</h2>}
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
