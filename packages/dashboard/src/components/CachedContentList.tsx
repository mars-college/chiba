import type { ContentSummary } from '@chiba/shared';

interface CachedContentListProps {
  content: ContentSummary[];
  onPlay: (filename: string) => void;
}

export function CachedContentList({ content, onPlay }: CachedContentListProps) {
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getContentIcon = (contentType: 'video' | 'image') => {
    if (contentType === 'video') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      );
    }
    if (contentType === 'image') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    }
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  };

  if (content.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '30px' }}>
        <div className="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="36" height="36">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <h3 className="empty-state-title">No cached content</h3>
        <p className="empty-state-description">
          Content will appear here when you preload media to this node.
        </p>
      </div>
    );
  }

  return (
    <div className="content-list">
      {content.map((item) => (
        <div key={item.hash} className="content-item">
          <div className="content-icon">
            {getContentIcon(item.type)}
          </div>
          <div className="content-info">
            <div className="content-name">{item.name || item.filename}</div>
            {item.name && (
              <div className="content-meta" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {item.filename}
              </div>
            )}
            <div className="content-meta">
              {formatBytes(item.sizeBytes)} &middot; {item.type}
            </div>
          </div>
          <div className="content-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onPlay(item.filename)}
            >
              Play
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
