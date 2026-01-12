import { useState, useEffect } from 'react';
import type { Playlist, Content, NodeStatus } from '@chiba/shared';
import { apiGet, apiPost, apiPut, apiDelete } from '../hooks/useApi';

export function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editPlaylist, setEditPlaylist] = useState<Playlist | null>(null);
  const [playPlaylist, setPlayPlaylist] = useState<Playlist | null>(null);
  const [content, setContent] = useState<Content[]>([]);
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [playingTo, setPlayingTo] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const fetchContent = async () => {
    try {
      const response = await apiGet<{ success: boolean; data: Content[] }>('/content');
      setContent(response.data || []);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    }
  };

  const fetchNodes = async () => {
    try {
      const response = await apiGet<{ success: boolean; data: { nodes: NodeStatus[] } }>('/nodes');
      setNodes(response.data.nodes || []);
    } catch (err) {
      console.error('Failed to fetch nodes:', err);
    }
  };

  const openEditModal = (playlist: Playlist) => {
    setEditPlaylist(playlist);
    setEditName(playlist.name);
    fetchContent();
  };

  const closeEditModal = () => {
    setEditPlaylist(null);
    setEditName('');
  };

  const handleSavePlaylist = async () => {
    if (!editPlaylist) return;
    setSaving(true);
    try {
      await apiPut(`/playlists/${editPlaylist.id}`, {
        name: editName.trim(),
      });
      setMessage({ type: 'success', text: 'Playlist updated' });
      fetchPlaylists();
      closeEditModal();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to save: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!editPlaylist) return;
    if (!window.confirm(`Delete playlist "${editPlaylist.name}"?`)) return;

    try {
      await apiDelete(`/playlists/${editPlaylist.id}`);
      setMessage({ type: 'success', text: 'Playlist deleted' });
      fetchPlaylists();
      closeEditModal();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to delete: ${(err as Error).message}` });
    }
  };

  const handleAddItemToPlaylist = async (item: Content) => {
    if (!editPlaylist) return;
    try {
      const source = item.originalUrl
        ? { url: item.originalUrl, name: item.name || item.filename }
        : { filename: item.filename, name: item.name || item.filename };

      await apiPost(`/playlists/${editPlaylist.id}/items`, {
        items: [source],
      });
      // Refresh the playlist to show new item
      const response = await apiGet<{ success: boolean; data: Playlist }>(`/playlists/${editPlaylist.id}`);
      setEditPlaylist(response.data);
      fetchPlaylists();
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to add item: ${(err as Error).message}` });
    }
  };

  const handleRemoveItemFromPlaylist = async (index: number) => {
    if (!editPlaylist) return;
    try {
      await apiDelete(`/playlists/${editPlaylist.id}/items/${index}`);
      // Refresh the playlist
      const response = await apiGet<{ success: boolean; data: Playlist }>(`/playlists/${editPlaylist.id}`);
      setEditPlaylist(response.data);
      fetchPlaylists();
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to remove item: ${(err as Error).message}` });
    }
  };

  const openPlayModal = (playlist: Playlist) => {
    setPlayPlaylist(playlist);
    fetchNodes();
  };

  const handlePlayOnNode = async (nodeId: string) => {
    if (!playPlaylist) return;
    setPlayingTo(nodeId);
    try {
      await apiPost(`/playlists/${playPlaylist.id}/play`, { nodeId });
      const node = nodes.find(n => n.node.id === nodeId);
      setMessage({ type: 'success', text: `Playing "${playPlaylist.name}" on ${node?.node.friendlyName}` });
      setPlayPlaylist(null);
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to play: ${(err as Error).message}` });
    } finally {
      setPlayingTo(null);
    }
  };

  // Playlist items from API have: { id, sourceType, sourceData: { url?, filename?, id? }, name?, order }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getItemLabel = (item: any) => {
    // Check for name first
    if (item.name) return item.name;

    // Handle sourceType/sourceData structure (from API)
    if (item.sourceData) {
      if (item.sourceData.filename) return item.sourceData.filename;
      if (item.sourceData.url) return item.sourceData.url;
      if (item.sourceData.id) return `Eden: ${item.sourceData.id}`;
    }

    // Fallback to content structure (type definition)
    const c = item.content;
    if (c) {
      if (c.name) return c.name;
      if (c.filename) return c.filename;
      if (c.url) return c.url;
      if (c.collectionId) return `Eden: ${c.collectionId}`;
    }

    return 'Unknown';
  };

  // Check if content item is already in the playlist
  const isContentInPlaylist = (contentItem: Content): boolean => {
    if (!editPlaylist) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return editPlaylist.items.some((item: any) => {
      if (item.sourceData?.filename === contentItem.filename) return true;
      if (item.sourceData?.url && contentItem.originalUrl && item.sourceData.url === contentItem.originalUrl) return true;
      return false;
    });
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
                        const label = getItemLabel(item);
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
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => openEditModal(playlist)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => openPlayModal(playlist)}
                >
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

      {/* Edit Playlist Modal */}
      {editPlaylist && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Edit Playlist</h2>
              <button className="modal-close" onClick={closeEditModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              {/* Current Items */}
              <div className="form-group">
                <label className="form-label">Items ({editPlaylist.items.length})</label>
                {editPlaylist.items.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No items yet. Add content from the library below.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                    {editPlaylist.items.map((item, index) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          backgroundColor: 'var(--bg-secondary)',
                          borderRadius: '4px',
                        }}
                      >
                        <span style={{ fontSize: '0.875rem' }}>{getItemLabel(item)}</span>
                        <button
                          className="btn btn-sm"
                          style={{ padding: '4px 8px', backgroundColor: 'var(--error)', color: 'white' }}
                          onClick={() => handleRemoveItemFromPlaylist(index)}
                          title="Remove from playlist"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add from Content Library */}
              <div className="form-group">
                <label className="form-label">Add from Content Library</label>
                {content.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    No content in library. Add content on the Content page first.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                    {content.filter(item => !isContentInPlaylist(item)).map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          backgroundColor: 'var(--bg-tertiary)',
                          borderRadius: '4px',
                        }}
                      >
                        <span style={{ fontSize: '0.875rem' }}>{item.name || item.filename}</span>
                        <button
                          className="btn btn-sm"
                          style={{ padding: '4px 8px', backgroundColor: 'var(--success)', color: 'white' }}
                          onClick={() => handleAddItemToPlaylist(item)}
                          title="Add to playlist"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {content.filter(item => !isContentInPlaylist(item)).length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '8px' }}>
                        All content has been added to this playlist.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button
                className="btn"
                style={{ backgroundColor: 'var(--error)', color: 'white' }}
                onClick={handleDeletePlaylist}
              >
                Delete Playlist
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary" onClick={closeEditModal}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSavePlaylist}
                  disabled={!editName.trim() || saving}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Play Playlist Modal */}
      {playPlaylist && (
        <div className="modal-overlay" onClick={() => setPlayPlaylist(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Play Playlist</h2>
              <button className="modal-close" onClick={() => setPlayPlaylist(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                Select a node to play <strong>{playPlaylist.name}</strong> on:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {nodes.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                    No nodes connected
                  </p>
                ) : (
                  nodes.map(node => (
                    <button
                      key={node.node.id}
                      className="btn btn-secondary"
                      style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                      onClick={() => handlePlayOnNode(node.node.id)}
                      disabled={playingTo !== null}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                        <span className={`status-dot ${node.connected ? 'online' : 'offline'}`} />
                        <span style={{ flex: 1 }}>{node.node.friendlyName}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {node.node.ip}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPlayPlaylist(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global message display */}
      {message && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '12px 20px',
          borderRadius: '8px',
          backgroundColor: message.type === 'success' ? 'var(--success)' : 'var(--error)',
          color: 'white',
          zIndex: 1001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {message.text}
        </div>
      )}
    </div>
  );
}
