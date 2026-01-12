import { Link } from 'react-router-dom';
import type { NodeStatus } from '@chiba/shared';

interface NodeCardProps {
  status: NodeStatus;
}

export function NodeCard({ status }: NodeCardProps) {
  const { node, connected, lastSeen, playbackState, diskUsage } = status;
  const nodeId = node.id || '';

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const formatTime = (ms: number): string => {
    const date = new Date(ms);
    return date.toLocaleTimeString();
  };

  const diskPercent = diskUsage
    ? Math.round((diskUsage.usedBytes / diskUsage.totalBytes) * 100)
    : 0;

  const getPlaybackLabel = (): string => {
    if (!playbackState) return 'Unknown';
    switch (playbackState.mode) {
      case 'off': return 'Idle';
      case 'video': return 'Playing Video';
      case 'image': return 'Showing Image';
      case 'playlist': return `Playlist (${playbackState.playlistIndex + 1}/${playbackState.playlist?.items.length || 0})`;
      case 'url': return 'Displaying URL';
      default: return playbackState.mode;
    }
  };

  return (
    <div className="node-card">
      <div className="node-card-header">
        <span className="node-name">{node.friendlyName}</span>
        <div className="node-status">
          <span className={`status-dot ${connected ? 'online' : 'offline'}`} />
          {connected ? 'Online' : 'Offline'}
        </div>
      </div>

      <div className="node-card-body">
        <div className="node-info-row">
          <span className="node-info-label">IP Address</span>
          <span className="node-info-value">{node.ip || 'Unknown'}</span>
        </div>
        <div className="node-info-row">
          <span className="node-info-label">Last Seen</span>
          <span className="node-info-value">
            {connected ? 'Now' : formatTime(lastSeen)}
          </span>
        </div>
        {diskUsage && (
          <div className="node-info-row">
            <span className="node-info-label">Disk</span>
            <span className="node-info-value">
              {formatBytes(diskUsage.totalBytes - diskUsage.usedBytes)} free
            </span>
          </div>
        )}

        <div className="node-playback">
          <span className={`playback-mode ${playbackState?.mode !== 'off' ? 'playing' : ''}`}>
            {getPlaybackLabel()}
          </span>
          {playbackState?.currentContent && (
            <div className="node-info-row" style={{ marginTop: '8px' }}>
              <span className="node-info-label">Content</span>
              <span className="node-info-value" style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {playbackState.currentContent.filename || 'Unknown'}
              </span>
            </div>
          )}
        </div>

        {diskUsage && (
          <div className="progress-bar" style={{ marginTop: '12px' }}>
            <div
              className={`progress-fill ${diskPercent > 90 ? 'error' : diskPercent > 75 ? 'warning' : ''}`}
              style={{ width: `${diskPercent}%` }}
            />
          </div>
        )}
      </div>

      <div className="node-card-footer">
        <Link
          to={nodeId ? `/nodes/${nodeId}` : '#'}
          className="btn btn-primary btn-sm"
          style={{ flex: 1 }}
          onClick={(e) => {
            if (!nodeId) {
              e.preventDefault();
              console.error('Node ID is empty');
            }
          }}
        >
          Open
        </Link>
      </div>
    </div>
  );
}
