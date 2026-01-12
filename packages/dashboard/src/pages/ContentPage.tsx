import { useState, useEffect } from 'react';
import type { Content, NodeStatus } from '@chiba/shared';
import { apiGet, apiPost, apiDelete } from '../hooks/useApi';

export function ContentPage() {
  const [content, setContent] = useState<Content[]>([]);
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [authorInput, setAuthorInput] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [adding, setAdding] = useState(false);
  const [sendingTo, setSendingTo] = useState<{ contentId: string; nodeId: string } | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedContent, setSelectedContent] = useState<Content | null>(null);
  const [sendToContent, setSendToContent] = useState<Content | null>(null); // For "Send to" modal

  useEffect(() => {
    fetchContent();
    fetchNodes();
  }, []);

  const fetchContent = async () => {
    try {
      const response = await apiGet<{ success: boolean; data: Content[] }>('/content');
      setContent(response.data || []);
    } catch (err) {
      console.error('Failed to fetch content:', err);
    } finally {
      setLoading(false);
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

  const handleSendToNode = async (item: Content, nodeId: string) => {
    const node = nodes.find(n => n.node.id === nodeId);
    if (!node) return;

    setSendingTo({ contentId: item.id, nodeId });
    setMessage(null);
    setSendToContent(null); // Close modal

    try {
      // Get the URL to send - either originalUrl or construct from source
      const url = item.originalUrl || (item.source as { url?: string }).url;
      if (!url) {
        throw new Error('No URL available for this content');
      }

      // Send play command to node which will download and cache
      // Include name so the node can store it with the cached content
      await apiPost(`/nodes/${nodeId}/play`, {
        type: item.source.type,
        url,
        name: item.name, // Pass the friendly name
        loop: false,
      });

      setMessage({
        type: 'success',
        text: `Sent "${item.name || item.filename}" to ${node.node.friendlyName}. It will download and start playing.`
      });
      setTimeout(() => setMessage(null), 5000);
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to send to node: ${(err as Error).message}`
      });
    } finally {
      setSendingTo(null);
    }
  };

  const handleDeleteContent = async (item: Content) => {
    if (!window.confirm(`Delete "${item.name || item.filename}" from the content library?`)) {
      return;
    }

    try {
      await apiDelete(`/content/${item.id}`);
      setMessage({ type: 'success', text: 'Content deleted from library' });
      fetchContent();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: `Failed to delete: ${(err as Error).message}` });
    }
  };

  const handleAddContent = async () => {
    if (!urlInput.trim()) return;

    setAdding(true);
    setMessage(null);

    try {
      const input = urlInput.trim();

      interface ContentResponse {
        success: boolean;
        data: {
          type?: 'collection' | 'creation';
          collectionName?: string;
          playlistName?: string;
          contentCount?: number;
          name?: string;
        };
      }

      const response = await apiPost<ContentResponse>('/content', {
        url: input,
        name: nameInput.trim() || undefined,
        description: descriptionInput.trim() || undefined,
        author: authorInput.trim() || undefined,
      });

      // Reset form
      setUrlInput('');
      setNameInput('');
      setDescriptionInput('');
      setAuthorInput('');
      setShowDescription(false);

      // Generate success message based on response
      let successMessage = 'Content added successfully';
      const data = response.data;

      if (data.type === 'collection') {
        successMessage = `Added Eden collection "${data.collectionName || data.playlistName}": ${data.contentCount} items added to library and playlist "${data.playlistName}" created.`;
      } else if (data.type === 'creation') {
        successMessage = `Eden creation "${data.name}" added to library.`;
      } else if (input.includes('youtube.com') || input.includes('youtu.be')) {
        successMessage = 'YouTube video added. It will be downloaded when played on a node.';
      }

      setMessage({ type: 'success', text: successMessage });
      fetchContent();
      setTimeout(() => setMessage(null), 8000); // Longer timeout for collection messages
    } catch (err) {
      console.error('Failed to add content:', err);
      setMessage({ type: 'error', text: `Failed to add content: ${(err as Error).message}` });
    } finally {
      setAdding(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getSourceBadge = (sourceType: string) => {
    switch (sourceType) {
      case 'youtube':
        return <span className="badge badge-error">YouTube</span>;
      case 'eden':
        return <span className="badge badge-success">Eden</span>;
      case 'url':
        return <span className="badge badge-info">URL</span>;
      default:
        return <span className="badge">{sourceType}</span>;
    }
  };

  const getContentIcon = (type: 'video' | 'image') => {
    if (type === 'video') {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      );
    }
    if (type === 'image') {
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Content Library</h1>
        <p className="page-subtitle">
          Manage your media content and sources
        </p>
      </div>

      {/* Add Content Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Add Content</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <label className="form-label">URL</label>
              <input
                type="text"
                className="form-input"
                placeholder="YouTube, Eden, or direct media URL"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !showDescription && handleAddContent()}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleAddContent}
              disabled={!urlInput.trim() || adding}
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>

          {/* Collapsible metadata section */}
          <div style={{ marginTop: '12px' }}>
            <button
              type="button"
              onClick={() => setShowDescription(!showDescription)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 0,
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: showDescription ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Add name, description
            </button>

            {showDescription && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    value={descriptionInput}
                    onChange={(e) => setDescriptionInput(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Author</label>
                  <input
                    type="text"
                    className="form-input"
                    value={authorInput}
                    onChange={(e) => setAuthorInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddContent()}
                  />
                </div>
              </div>
            )}
          </div>

          {message && (
            <div style={{
              marginTop: '12px',
              padding: '8px 12px',
              borderRadius: '4px',
              backgroundColor: message.type === 'success' ? 'var(--success-bg, rgba(34, 197, 94, 0.1))' : 'var(--error-bg, rgba(239, 68, 68, 0.1))',
              color: message.type === 'success' ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
              fontSize: '0.875rem',
            }}>
              {message.text}
            </div>
          )}
        </div>
      </div>

      {/* Content List */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">All Content</h3>
          <span className="badge badge-info">{content.length} items</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="loading-container">
              <div className="loading-spinner" />
            </div>
          ) : content.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <h2 className="empty-state-title">No content yet</h2>
              <p className="empty-state-description">
                Add content using the form above to get started.
              </p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Content</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {content.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="content-icon">
                          {getContentIcon(item.type)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{item.name || item.filename}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {item.name ? item.filename : `${item.hash.substring(0, 8)}...`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{getSourceBadge(item.source.type)}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      {item.type}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {nodes.length > 0 && (
                          <button
                            className="btn btn-sm"
                            style={{ padding: '6px 8px', backgroundColor: 'var(--success)', color: 'white' }}
                            onClick={() => setSendToContent(item)}
                            disabled={sendingTo?.contentId === item.id}
                            title="Send to node"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                        )}
                        <button
                          className="btn btn-sm"
                          style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}
                          onClick={() => setSelectedContent(item)}
                          title="View details"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ padding: '6px 8px', backgroundColor: 'var(--error)', color: 'white' }}
                          onClick={() => handleDeleteContent(item)}
                          title="Delete from library"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Details Modal */}
      {selectedContent && (
        <div className="modal-overlay" onClick={() => setSelectedContent(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Content Details</h3>
              <button
                className="modal-close"
                onClick={() => setSelectedContent(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span className="detail-label">Name</span>
                <span className="detail-value">{selectedContent.name || '(none)'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Filename</span>
                <span className="detail-value" style={{ wordBreak: 'break-all' }}>
                  {selectedContent.filename}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Hash</span>
                <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {selectedContent.hash}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Type</span>
                <span className="detail-value">{selectedContent.type}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Source</span>
                <span className="detail-value">{selectedContent.source.type}</span>
              </div>
              {selectedContent.metadata?.author && (
                <div className="detail-row">
                  <span className="detail-label">Author</span>
                  <span className="detail-value">{selectedContent.metadata.author}</span>
                </div>
              )}
              {selectedContent.metadata?.description && (
                <div className="detail-row">
                  <span className="detail-label">Description</span>
                  <span className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>
                    {selectedContent.metadata.description}
                  </span>
                </div>
              )}
              {selectedContent.originalUrl && (
                <div className="detail-row">
                  <span className="detail-label">Original URL</span>
                  <span className="detail-value" style={{ wordBreak: 'break-all', fontSize: '0.875rem' }}>
                    {selectedContent.originalUrl}
                  </span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Size</span>
                <span className="detail-value">
                  {selectedContent.sizeBytes > 0 ? formatBytes(selectedContent.sizeBytes) : 'Unknown (not yet downloaded)'}
                </span>
              </div>
              {selectedContent.duration && (
                <div className="detail-row">
                  <span className="detail-label">Duration</span>
                  <span className="detail-value">{selectedContent.duration}s</span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span className="detail-value">
                  {new Date(selectedContent.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedContent(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send to Node Modal */}
      {sendToContent && (
        <div className="modal-overlay" onClick={() => setSendToContent(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Send to Node</h3>
              <button
                className="modal-close"
                onClick={() => setSendToContent(null)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                Select a node to send <strong>{sendToContent.name || sendToContent.filename}</strong> to:
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
                      onClick={() => handleSendToNode(sendToContent, node.node.id)}
                      disabled={sendingTo !== null}
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
              <button
                className="btn btn-secondary"
                onClick={() => setSendToContent(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
