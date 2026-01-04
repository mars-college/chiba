import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../hooks/useApi';
import type { NodeStatus } from '@chiba/shared';

export function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [controllerUrl, setControllerUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [clearingCache, setClearingCache] = useState<string | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  useEffect(() => {
    // Load saved settings
    const savedApiKey = localStorage.getItem('apiKey') || '';
    const savedControllerUrl = localStorage.getItem('controllerUrl') || '';
    setApiKey(savedApiKey);
    setControllerUrl(savedControllerUrl);

    // Load nodes
    fetchNodes();
  }, []);

  const fetchNodes = async () => {
    try {
      const response = await apiGet<{ success: boolean; data: { nodes: NodeStatus[] } }>('/nodes');
      setNodes(response.data.nodes);
    } catch (err) {
      console.error('Failed to fetch nodes:', err);
    }
  };

  const handleSave = () => {
    localStorage.setItem('apiKey', apiKey);
    localStorage.setItem('controllerUrl', controllerUrl);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleClearBrowserCache = () => {
    if (window.confirm('Are you sure you want to clear dashboard settings?')) {
      localStorage.clear();
      setApiKey('');
      setControllerUrl('');
      window.location.reload();
    }
  };

  const handleClearNodeCache = async (nodeId: string, nodeName: string) => {
    if (!window.confirm(`Are you sure you want to clear all cached content on "${nodeName}"? This will delete all downloaded videos and images.`)) {
      return;
    }

    setClearingCache(nodeId);
    setCacheMessage(null);

    try {
      const response = await apiPost<{ success: boolean; data: { deletedCount: number; freedBytes: number } }>(
        `/nodes/${nodeId}/clear-cache`
      );
      const { deletedCount, freedBytes } = response.data;
      const freedMB = (freedBytes / 1024 / 1024).toFixed(1);
      setCacheMessage(`Cleared ${deletedCount} files (${freedMB} MB) from ${nodeName}`);
      // Refresh nodes to update cache info
      fetchNodes();
    } catch (err) {
      setCacheMessage(`Failed to clear cache: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setClearingCache(null);
    }
  };

  const handleClearAllNodeCaches = async () => {
    if (!window.confirm('Are you sure you want to clear cached content on ALL nodes? This will delete all downloaded videos and images from every connected node.')) {
      return;
    }

    setClearingCache('all');
    setCacheMessage(null);

    let totalDeleted = 0;
    let totalFreed = 0;
    let errors = 0;

    for (const node of nodes) {
      try {
        const response = await apiPost<{ success: boolean; data: { deletedCount: number; freedBytes: number } }>(
          `/nodes/${node.node.id}/clear-cache`
        );
        totalDeleted += response.data.deletedCount;
        totalFreed += response.data.freedBytes;
      } catch {
        errors++;
      }
    }

    const freedMB = (totalFreed / 1024 / 1024).toFixed(1);
    if (errors > 0) {
      setCacheMessage(`Cleared ${totalDeleted} files (${freedMB} MB) with ${errors} error(s)`);
    } else {
      setCacheMessage(`Cleared ${totalDeleted} files (${freedMB} MB) from all nodes`);
    }

    setClearingCache(null);
    fetchNodes();
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          Configure dashboard preferences
        </p>
      </div>

      {saved && (
        <div className="alert alert-success" style={{ marginBottom: '24px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>Settings saved successfully!</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Authentication</h3>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter your API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
              The API key is used to authenticate with the controller. This should match the
              API_KEY environment variable on your controller server.
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Connection</h3>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Controller URL (optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="http://localhost:8080"
              value={controllerUrl}
              onChange={(e) => setControllerUrl(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
              Leave empty to use the current host. Only needed if the controller is on a different server.
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">About</h3>
        </div>
        <div className="card-body">
          <div className="node-info-row">
            <span className="node-info-label">Version</span>
            <span className="node-info-value">2.0.0</span>
          </div>
          <div className="node-info-row">
            <span className="node-info-label">Package</span>
            <span className="node-info-value">@chiba/dashboard</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Node Content Cache</h3>
        </div>
        <div className="card-body">
          {cacheMessage && (
            <div className={`alert ${cacheMessage.includes('Failed') ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: '16px' }}>
              {cacheMessage}
            </div>
          )}

          {nodes.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>No nodes connected.</p>
          ) : (
            <>
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Clear downloaded videos and images from node storage.
                </p>
                {nodes.map(node => (
                  <div key={node.node.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{node.node.friendlyName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {node.cachedContent?.length || 0} files cached
                      </div>
                    </div>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleClearNodeCache(node.node.id, node.node.friendlyName)}
                      disabled={clearingCache !== null}
                    >
                      {clearingCache === node.node.id ? 'Clearing...' : 'Clear'}
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="btn btn-danger"
                onClick={handleClearAllNodeCaches}
                disabled={clearingCache !== null}
                style={{ width: '100%' }}
              >
                {clearingCache === 'all' ? 'Clearing All...' : 'Clear All Node Caches'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Dashboard Settings</h3>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 500 }}>Reset Dashboard</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Clear browser storage (API key, preferences). Does not affect node content.
              </div>
            </div>
            <button className="btn btn-secondary" onClick={handleClearBrowserCache}>
              Reset
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={handleSave}>
          Save Settings
        </button>
      </div>
    </div>
  );
}
