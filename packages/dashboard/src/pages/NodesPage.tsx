import { useWebSocket } from '../hooks/useWebSocket';
import { NodeCard } from '../components/NodeCard';

export function NodesPage() {
  const { nodes, connected } = useWebSocket();

  const onlineNodes = nodes.filter(n => n.connected);
  const offlineNodes = nodes.filter(n => !n.connected);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Nodes</h1>
        <p className="page-subtitle">
          {connected ? (
            <>
              {onlineNodes.length} online, {offlineNodes.length} offline
            </>
          ) : (
            'Connecting...'
          )}
        </p>
      </div>

      {nodes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <h2 className="empty-state-title">No nodes connected</h2>
          <p className="empty-state-description">
            Nodes will appear here once they register with the controller.
            Make sure your Raspberry Pi nodes are configured and running.
          </p>
        </div>
      ) : (
        <div className="node-grid">
          {nodes.map(node => (
            <NodeCard key={node.node.id} status={node} />
          ))}
        </div>
      )}
    </div>
  );
}
