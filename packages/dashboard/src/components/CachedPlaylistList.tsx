import { useState } from 'react';
import type { PlaylistSummary } from '@chiba/shared';

interface CachedPlaylistListProps {
  playlists: PlaylistSummary[];
  onPlay: (playlistId: string, startIndex?: number) => void;
  onPlayItem: (filename: string) => void;
  disabled?: boolean;
}

export function CachedPlaylistList({
  playlists,
  onPlay,
  onPlayItem,
  disabled
}: CachedPlaylistListProps) {
  const [expandedPlaylists, setExpandedPlaylists] = useState<Set<string>>(new Set());

  const toggleExpanded = (playlistId: string) => {
    const newExpanded = new Set(expandedPlaylists);
    if (newExpanded.has(playlistId)) {
      newExpanded.delete(playlistId);
    } else {
      newExpanded.add(playlistId);
    }
    setExpandedPlaylists(newExpanded);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  if (playlists.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '30px' }}>
        <div className="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="36" height="36">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </div>
        <h3 className="empty-state-title">No cached playlists</h3>
        <p className="empty-state-description">
          Playlists will appear here when you play or cache content on this node.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {playlists.map((playlist) => {
        const isExpanded = expandedPlaylists.has(playlist.id);
        const cachedCount = playlist.items.filter(i => i.isCached).length;

        return (
          <div
            key={playlist.id}
            style={{
              border: '1px solid var(--border-light)',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {/* Playlist header */}
            <div
              onClick={() => toggleExpanded(playlist.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px',
                gap: '12px',
                background: 'var(--bg-secondary)',
                cursor: 'pointer',
              }}
            >
              <div style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2"
                  style={{
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s'
                  }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {playlist.name}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {playlist.itemCount} items
                  ({cachedCount} cached)
                  {playlist.totalSizeBytes > 0 && ` \u00B7 ${formatBytes(playlist.totalSizeBytes)}`}
                  {playlist.loop && ' \u00B7 Loop'}
                </div>
              </div>

              <div style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => onPlay(playlist.id)}
                  disabled={disabled || cachedCount === 0}
                >
                  Play
                </button>
              </div>
            </div>

            {/* Expanded items */}
            {isExpanded && (
              <div style={{
                borderTop: '1px solid var(--border-light)',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}>
                {playlist.items.map((item, index) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px',
                      gap: '10px',
                      borderRadius: '4px',
                      opacity: item.isCached ? 1 : 0.6,
                    }}
                  >
                    <div style={{ width: '24px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {index + 1}
                    </div>

                    <div style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
                      {item.type === 'video' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="23 7 16 12 23 17 23 7" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      ) : item.type === 'image' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name || item.filename || `Item ${index + 1}`}
                      </div>
                      {item.sizeBytes !== undefined && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {formatBytes(item.sizeBytes)}
                        </div>
                      )}
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      {item.isCached ? (
                        <span style={{
                          fontSize: '0.65rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'rgba(34, 197, 94, 0.1)',
                          color: 'var(--success)',
                        }}>
                          Cached
                        </span>
                      ) : (
                        <span style={{
                          fontSize: '0.65rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'rgba(245, 158, 11, 0.1)',
                          color: 'var(--warning)',
                        }}>
                          Not cached
                        </span>
                      )}
                    </div>

                    {item.isCached && item.filename && (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '2px 6px', fontSize: '0.65rem' }}
                        onClick={() => onPlayItem(item.filename!)}
                        disabled={disabled}
                      >
                        Play
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
