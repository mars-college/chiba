import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import type { NodeStatus, DisplayRotation } from '@chiba/shared';
import { apiGet, apiPost } from '../hooks/useApi';
import { PlaybackPanel } from '../components/PlaybackPanel';
import { CachedContentList } from '../components/CachedContentList';
import { HardwareMetricsBar } from '../components/HardwareMetricsBar';
import { RotationControl } from '../components/RotationControl';

export function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [node, setNode] = useState<NodeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNode = async () => {
    if (!id) return;
    try {
      const response = await apiGet<{ success: boolean; data: { node: NodeStatus } }>(`/nodes/${id}`);
      setNode(response.data.node);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load node');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    fetchNode();
    const interval = setInterval(fetchNode, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [id]);

  const [playError, setPlayError] = useState<string | null>(null);
  const [playLoading, setPlayLoading] = useState(false);

  const handlePlay = async (source: { type: string; url?: string; filename?: string }) => {
    if (!id) return;
    setPlayError(null);
    setPlayLoading(true);
    try {
      await apiPost(`/nodes/${id}/play`, source);
      setTimeout(fetchNode, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Play failed';
      setPlayError(errorMsg);
      console.error('Play failed:', err);
    } finally {
      setPlayLoading(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/stop`);
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Stop failed:', err);
    }
  };

  const handlePause = async () => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/pause`);
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Pause failed:', err);
    }
  };

  const handleResume = async () => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/resume`);
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Resume failed:', err);
    }
  };

  const handleNext = async () => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/next`);
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Next failed:', err);
    }
  };

  const handlePrevious = async () => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/previous`);
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Previous failed:', err);
    }
  };

  const handleVolumeChange = async (volume: number) => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/volume`, { volume });
    } catch (err) {
      console.error('Volume change failed:', err);
    }
  };

  const handleLoopChange = async (enabled: boolean) => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/loop`, { enabled });
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Loop change failed:', err);
    }
  };

  const handleShuffleChange = async (enabled: boolean) => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/shuffle`, { enabled });
      setTimeout(fetchNode, 200);
    } catch (err) {
      console.error('Shuffle change failed:', err);
    }
  };

  const handleImageDurationChange = async (duration: number) => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/image-duration`, { duration });
    } catch (err) {
      console.error('Image duration change failed:', err);
    }
  };

  const [rotationLoading, setRotationLoading] = useState(false);
  const [clearCacheLoading, setClearCacheLoading] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleClearCache = async () => {
    if (!id) return;
    if (!window.confirm('Are you sure you want to clear all cached content on this node? This cannot be undone.')) {
      return;
    }
    setClearCacheLoading(true);
    try {
      await apiPost(`/nodes/${id}/clear-cache`);
      setTimeout(fetchNode, 500);
    } catch (err) {
      console.error('Clear cache failed:', err);
    } finally {
      setClearCacheLoading(false);
    }
  };

  const handleRotationChange = async (rotation: DisplayRotation) => {
    if (!id) return;
    setRotationLoading(true);
    try {
      await apiPost(`/nodes/${id}/rotate`, { rotation });
      setTimeout(fetchNode, 500);
    } catch (err) {
      console.error('Rotation change failed:', err);
    } finally {
      setRotationLoading(false);
    }
  };

  const openRenameModal = () => {
    if (node) {
      setRenameValue(node.node.friendlyName);
      setRenameError(null);
      setShowRenameModal(true);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !renameValue.trim()) return;

    setRenameLoading(true);
    setRenameError(null);
    try {
      await apiPost(`/nodes/${id}/rename`, { name: renameValue.trim() });
      setShowRenameModal(false);
      fetchNode();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setRenameLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error || !node) {
    return (
      <div>
        <div className="page-header">
          <Link to="/" className="btn btn-secondary btn-sm" style={{ marginBottom: '16px' }}>
            Back to Nodes 33
          </Link>
          <h1 className="page-title">Node Not Found</h1>
        </div>
        <div className="alert alert-error">
          {error || 'Node not found'}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header Section */}
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <Link to="/" className="btn btn-secondary btn-sm" style={{ marginBottom: '16px' }}>
          Back to Nodes 44
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <h1 className="page-title" style={{ margin: 0 }}>{node.node.friendlyName}</h1>
          <button
            className="btn btn-secondary btn-sm"
            onClick={openRenameModal}
            style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
            title="Rename node"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <a
            href={`http://${node.node.ip}:${node.node.port}/player?kiosk`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none', padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
            title="Open player in new tab"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px', flexWrap: 'wrap' }}>
          <p className="page-subtitle" style={{ margin: 0 }}>
            <span className={`status-dot ${node.connected ? 'online' : 'offline'}`} style={{ display: 'inline-block', marginRight: '8px' }} />
            {node.connected ? 'Online' : 'Offline'} &middot; {node.node.ip}
          </p>
          {node.hardware && (
            <>
              <span style={{ color: 'var(--border-light)' }}>|</span>
              <HardwareMetricsBar metrics={node.hardware} />
            </>
          )}
        </div>
      </div>

      {playError && (
        <div className="alert alert-error" style={{ marginBottom: '20px' }}>
          <strong>Play failed:</strong> {playError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) minmax(300px, 400px)', gap: '20px' }}>
        {/* Playback Panel (combined with volume) */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Playback</h3>
            {playLoading && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Loading...</span>}
          </div>
          <div className="card-body">
            <PlaybackPanel
              playbackState={node.playbackState}
              disabled={!node.connected}
              loading={playLoading}
              onPlay={handlePlay}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              onNext={handleNext}
              onPrevious={handlePrevious}
              onLoopChange={handleLoopChange}
              onShuffleChange={handleShuffleChange}
              onVolumeChange={handleVolumeChange}
              onImageDurationChange={handleImageDurationChange}
            />
          </div>
        </div>

        {/* Display Rotation */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Display Rotation</h3>
            {rotationLoading && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Applying...</span>}
          </div>
          <div className="card-body">
            <RotationControl
              rotation={node.node.displayRotation ?? 0}
              disabled={!node.connected || rotationLoading}
              onChange={handleRotationChange}
            />
          </div>
        </div>

        {/* Cached Content */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <h3 className="card-title">Cached Content</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="badge badge-info">
                {node.cachedContent?.length || 0} files
              </span>
              {(node.cachedContent?.length ?? 0) > 0 && (
                <button
                  className="btn btn-sm"
                  style={{
                    backgroundColor: 'var(--error)',
                    color: 'white',
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                  }}
                  onClick={handleClearCache}
                  disabled={!node.connected || clearCacheLoading}
                >
                  {clearCacheLoading ? 'Clearing...' : 'Clear All'}
                </button>
              )}
            </div>
          </div>
          <div className="card-body">
            <CachedContentList
              content={node.cachedContent || []}
              onPlay={(filename) => handlePlay({ type: 'file', filename })}
              disabled={playLoading}
            />
          </div>
        </div>
      </div>

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="modal-overlay" onClick={() => setShowRenameModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3 className="modal-title">Rename Node</h3>
              <button className="modal-close" onClick={() => setShowRenameModal(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleRename}>
              <div className="modal-body">
                {renameError && (
                  <div className="alert alert-error" style={{ marginBottom: '16px' }}>
                    {renameError}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Node Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Enter node name"
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRenameModal(false)}
                  disabled={renameLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={renameLoading || !renameValue.trim()}
                >
                  {renameLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
