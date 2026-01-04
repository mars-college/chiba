import type { HardwareMetrics as HardwareMetricsType } from '@chiba/shared';

interface HardwareMetricsProps {
  metrics: HardwareMetricsType;
}

export function HardwareMetrics({ metrics }: HardwareMetricsProps) {
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getTempClass = (temp: number): string => {
    if (temp >= 80) return 'error';
    if (temp >= 70) return 'warning';
    return '';
  };

  const getCpuClass = (usage: number): string => {
    if (usage >= 90) return 'error';
    if (usage >= 75) return 'warning';
    return '';
  };

  const memoryPercent = metrics.memoryTotal > 0
    ? Math.round((metrics.memoryUsed / metrics.memoryTotal) * 100)
    : 0;
  const diskPercent = metrics.diskTotal > 0
    ? Math.round((metrics.diskUsed / metrics.diskTotal) * 100)
    : 0;

  // Check if data is available
  const cpuTempAvailable = metrics.cpuTemp >= 0;
  const diskAvailable = metrics.diskTotal > 0;

  const getMemoryClass = (): string => {
    if (memoryPercent >= 90) return 'error';
    if (memoryPercent >= 75) return 'warning';
    return '';
  };

  const getDiskClass = (): string => {
    if (diskPercent >= 90) return 'error';
    if (diskPercent >= 75) return 'warning';
    return '';
  };

  return (
    <div className="metrics-grid">
      <div className="metric-card">
        <div className="metric-label">CPU Temp</div>
        <div className={`metric-value ${cpuTempAvailable ? getTempClass(metrics.cpuTemp) : ''}`}>
          {cpuTempAvailable ? `${metrics.cpuTemp.toFixed(1)}C` : 'N/A'}
        </div>
        {!cpuTempAvailable && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Not available on this platform
          </div>
        )}
      </div>

      <div className="metric-card">
        <div className="metric-label">CPU Usage</div>
        <div className={`metric-value ${getCpuClass(metrics.cpuUsage)}`}>
          {metrics.cpuUsage.toFixed(0)}%
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Memory</div>
        <div className={`metric-value ${getMemoryClass()}`}>
          {formatBytes(metrics.memoryUsed)}
        </div>
        <div className="progress-bar">
          <div
            className={`progress-fill ${getMemoryClass()}`}
            style={{ width: `${memoryPercent}%` }}
          />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          {memoryPercent}% of {formatBytes(metrics.memoryTotal)}
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Disk</div>
        {diskAvailable ? (
          <>
            <div className={`metric-value ${getDiskClass()}`}>
              {formatBytes(metrics.diskUsed)}
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${getDiskClass()}`}
                style={{ width: `${diskPercent}%` }}
              />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              {diskPercent}% of {formatBytes(metrics.diskTotal)}
            </div>
          </>
        ) : (
          <>
            <div className="metric-value">N/A</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Unable to read disk info
            </div>
          </>
        )}
      </div>
    </div>
  );
}
