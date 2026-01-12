import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import type { NodeStatus, DisplayRotation } from '@chiba/shared';
import { apiGet, apiPost } from '../hooks/useApi';
import { PlaybackControls } from '../components/PlaybackControls';
import { VolumeControl } from '../components/VolumeControl';
import { CachedContentList } from '../components/CachedContentList';
import { HardwareMetrics } from '../components/HardwareMetrics';
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

  const handlePlay = async (source: { type: string; url?: string; filename?: string; loop?: boolean }) => {
    if (!id) return;
    setPlayError(null);
    setPlayLoading(true);
    try {
      await apiPost(`/nodes/${id}/play`, source);
      // Fetch updated state after a short delay
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

  const handleVolumeChange = async (volume: number) => {
    if (!id) return;
    try {
      await apiPost(`/nodes/${id}/volume`, { volume });
      // No need to refresh for volume - it's handled optimistically in UI
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

  const [rotationLoading, setRotationLoading] = useState(false);

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
      <div className="page-header">
        <Link to="/" className="btn btn-secondary btn-sm" style={{ marginBottom: '16px' }}>
          Back to Nodes
        </Link>
        <h1 className="page-title">{node.node.friendlyName}</h1>
        <p className="page-subtitle">
          <span className={`status-dot ${node.connected ? 'online' : 'offline'}`} style={{ display: 'inline-block', marginRight: '8px' }} />
          {node.connected ? 'Online' : 'Offline'} &middot; {node.node.ip}
        </p>
      </div>

      {playError && (
        <div className="alert alert-error" style={{ marginBottom: '20px' }}>
          <strong>Play failed:</strong> {playError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
        {/* Playback Controls */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Playback</h3>
            {playLoading && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Loading...</span>}
          </div>
          <div className="card-body">
            <PlaybackControls
              playbackState={node.playbackState}
              disabled={!node.connected || playLoading}
              onPlay={handlePlay}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              onLoopChange={handleLoopChange}
            />
          </div>
        </div>

        {/* Volume Control */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Volume</h3>
          </div>
          <div className="card-body">
            <VolumeControl
              volume={node.playbackState?.volume ?? 100}
              disabled={!node.connected}
              onChange={handleVolumeChange}
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

        {/* Hardware Metrics */}
        {node.hardware && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Hardware</h3>
            </div>
            <div className="card-body">
              <HardwareMetrics metrics={node.hardware} />
            </div>
          </div>
        )}

        {/* Cached Content */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <h3 className="card-title">Cached Content</h3>
            <span className="badge badge-info">
              {node.cachedContent?.length || 0} files
            </span>
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
