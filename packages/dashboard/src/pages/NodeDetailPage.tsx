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

  const [rotationLoading, setRotationLoading] = useState(false);
  const [clearCacheLoading, setClearCacheLoading] = useState(false);

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
            Back to Nodes
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
          Back to Nodes
        </Link>
        <h1 className="page-title">{node.node.friendlyName}</h1>
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
    </div>
  );
}
