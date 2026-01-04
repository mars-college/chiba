import { useState, useEffect } from 'react';
import { VERSION } from '@chiba/shared';

interface DebugInfo {
  nodeName: string;
  nodeId: string;
  ipAddress: string;
  networkStatus: 'online' | 'offline' | 'connecting';
  controllerStatus: 'online' | 'offline' | 'connecting';
  cachedContent: Array<{
    filename: string;
    sizeBytes: number;
    type: string;
  }>;
  totalCacheSize: number;
}

interface DebugScreenProps {
  connected: boolean;
}

// Get base URL for node API (derive from ws query param or use current host)
function getNodeBaseUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get('ws');
  if (wsParam) {
    // Convert ws://localhost:8081/ws to http://localhost:8081
    try {
      const wsUrl = new URL(wsParam);
      const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:';
      return `${protocol}//${wsUrl.host}`;
    } catch {
      // Fall through to default
    }
  }
  return '';
}

export function DebugScreen({ connected }: DebugScreenProps) {
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const baseUrl = getNodeBaseUrl();

    const fetchDebugInfo = async () => {
      try {
        const response = await fetch(`${baseUrl}/debug`);
        if (response.ok) {
          const data = await response.json();
          setDebugInfo(data);
        }
      } catch (err) {
        console.error('Failed to fetch debug info:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDebugInfo();
    const interval = setInterval(fetchDebugInfo, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  if (loading) {
    return (
      <div className="debug-screen">
        <h1 className="debug-header">CHIBA v{VERSION}</h1>
        <div className="debug-section">
          <div className="debug-value">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="debug-screen">
      <h1 className="debug-header">CHIBA v{VERSION}</h1>

      <div className="debug-section">
        <div className="debug-section-title">Node</div>
        <div className="debug-value">{debugInfo?.nodeName || 'Unknown'}</div>
      </div>

      <div className="debug-section">
        <div className="debug-section-title">IP Address</div>
        <div className="debug-value">{debugInfo?.ipAddress || 'Unknown'}</div>
      </div>

      <div className="debug-section">
        <div className="debug-section-title">Network</div>
        <div className="debug-value">
          <span className="status-indicator">
            <span className={`status-dot ${debugInfo?.networkStatus || 'offline'}`} />
            {debugInfo?.networkStatus === 'online' ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="debug-section">
        <div className="debug-section-title">Controller</div>
        <div className="debug-value">
          <span className="status-indicator">
            <span className={`status-dot ${connected ? 'online' : 'connecting'}`} />
            {connected ? 'Online' : 'Connecting...'}
          </span>
        </div>
      </div>

      <div className="debug-section">
        <div className="debug-section-title">
          Cached Content ({debugInfo?.cachedContent?.length || 0} files, {formatBytes(debugInfo?.totalCacheSize || 0)})
        </div>
        <ul className="debug-list">
          {debugInfo?.cachedContent?.slice(0, 10).map((item, index) => (
            <li key={index}>
              {item.filename} ({formatBytes(item.sizeBytes)})
            </li>
          ))}
          {(debugInfo?.cachedContent?.length || 0) > 10 && (
            <li>... and {debugInfo!.cachedContent.length - 10} more</li>
          )}
          {!debugInfo?.cachedContent?.length && <li>No content cached</li>}
        </ul>
      </div>

      <div className="debug-section">
        <div className="debug-section-title">Status</div>
        <div className="debug-value">Ready</div>
      </div>
    </div>
  );
}
