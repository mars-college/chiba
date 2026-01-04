import { useState, useEffect } from 'react';
import type { Playlist } from '@chiba/shared';
import { apiGet, apiPost } from '../hooks/useApi';

export function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  useEffect(() => {
    fetchPlaylists();
  }, []);

  const fetchPlaylists = async () => {
    try {
      const response = await apiGet<{ success: boolean; data: Playlist[] }>('/playlists');
      setPlaylists(response.data || []);
    } catch (err) {
      console.error('Failed to fetch playlists:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;

    try {
      await apiPost('/playlists', {
        name: newPlaylistName.trim(),
        items: [],
        loop: true,
      });
      setNewPlaylistName('');
      setShowCreateModal(false);
      fetchPlaylists();
    } catch (err) {
      console.error('Failed to create playlist:', err);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Playlists</h1>
          <p className="page-subtitle">
            Create and manage content playlists
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          Create Playlist
        </button>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      ) : playlists.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </div>
          <h2 className="empty-state-title">No playlists yet</h2>
          <p className="empty-state-description">
            Create a playlist to organize your content for sequential playback.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: '16px' }}
            onClick={() => setShowCreateModal(true)}
          >
            Create Your First Playlist
          </button>
        </div>
      ) : (
        <div className="node-grid">
          {playlists.map((playlist) => (
            <div key={playlist.id} className="card">
              <div className="card-header">
                <h3 className="card-title">{playlist.name}</h3>
                {playlist.loop && (
                  <span className="badge badge-info">Loop</span>
                )}
              </div>
              <div className="card-body">
                <div className="node-info-row">
                  <span className="node-info-label">Items</span>
                  <span className="node-info-value">{playlist.items.length}</span>
                </div>
                {playlist.items.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div className="form-label">Contents:</div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {playlist.items.slice(0, 3).map((item, index) => {
                        const content = item.content;
                        let label = 'Unknown';
                        if ('filename' in content) {
                          label = content.filename;
                        } else if ('url' in content) {
                          label = content.url;
                        } else if ('collectionId' in content) {
                          label = `Eden: ${content.collectionId}`;
                        }
                        return (
                          <div key={index} style={{
                            padding: '4px 0',
                            borderBottom: index < Math.min(playlist.items.length, 3) - 1 ? '1px solid var(--border)' : 'none',
                          }}>
                            {label}
                          </div>
                        );
                      })}
                      {playlist.items.length > 3 && (
                        <div style={{ padding: '4px 0', color: 'var(--text-muted)' }}>
                          +{playlist.items.length - 3} more...
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="node-card-footer">
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                  Edit
                </button>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                  Play
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Playlist Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Create Playlist</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Playlist Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter playlist name..."
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreatePlaylist}
                disabled={!newPlaylistName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
