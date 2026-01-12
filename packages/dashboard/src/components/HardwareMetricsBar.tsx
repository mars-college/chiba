import type { HardwareMetrics as HardwareMetricsType } from '@chiba/shared';

interface HardwareMetricsBarProps {
  metrics: HardwareMetricsType;
}

export function HardwareMetricsBar({ metrics }: HardwareMetricsBarProps) {
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const getTempStatus = (temp: number): 'normal' | 'warning' | 'error' => {
    if (temp >= 80) return 'error';
    if (temp >= 70) return 'warning';
    return 'normal';
  };

  const getCpuStatus = (usage: number): 'normal' | 'warning' | 'error' => {
    if (usage >= 90) return 'error';
    if (usage >= 75) return 'warning';
    return 'normal';
  };

  const memoryPercent = metrics.memoryTotal > 0
    ? Math.round((metrics.memoryUsed / metrics.memoryTotal) * 100)
    : 0;
  const diskPercent = metrics.diskTotal > 0
    ? Math.round((metrics.diskUsed / metrics.diskTotal) * 100)
    : 0;

  const getMemoryStatus = (): 'normal' | 'warning' | 'error' => {
    if (memoryPercent >= 90) return 'error';
    if (memoryPercent >= 75) return 'warning';
    return 'normal';
  };

  const getDiskStatus = (): 'normal' | 'warning' | 'error' => {
    if (diskPercent >= 90) return 'error';
    if (diskPercent >= 75) return 'warning';
    return 'normal';
  };

  const getStatusColor = (status: 'normal' | 'warning' | 'error'): string => {
    switch (status) {
      case 'error': return 'var(--error)';
      case 'warning': return 'var(--warning)';
      default: return 'var(--text-secondary)';
    }
  };

  const cpuTempAvailable = metrics.cpuTemp >= 0;
  const diskAvailable = metrics.diskTotal > 0;

  const items: { label: string; value: string; status: 'normal' | 'warning' | 'error' }[] = [];

  if (cpuTempAvailable) {
    items.push({
      label: 'Temp',
      value: `${metrics.cpuTemp.toFixed(0)}°C`,
      status: getTempStatus(metrics.cpuTemp),
    });
  }

  items.push({
    label: 'CPU',
    value: `${metrics.cpuUsage.toFixed(0)}%`,
    status: getCpuStatus(metrics.cpuUsage),
  });

  items.push({
    label: 'RAM',
    value: `${memoryPercent}%`,
    status: getMemoryStatus(),
  });

  if (diskAvailable) {
    items.push({
      label: 'Disk',
      value: formatBytes(metrics.diskTotal - metrics.diskUsed),
      status: getDiskStatus(),
    });
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      fontSize: '0.8125rem',
      color: 'var(--text-secondary)',
    }}>
      {items.map((item) => (
        <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ opacity: 0.7 }}>{item.label}</span>
          <span style={{
            color: getStatusColor(item.status),
            fontFamily: "'SF Mono', Monaco, 'Courier New', monospace",
          }}>
            {item.value}
          </span>
        </span>
      ))}
    </div>
  );
}
