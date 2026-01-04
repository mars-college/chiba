/**
 * Hardware metrics collection service.
 * Collects CPU temperature, usage, memory, and disk stats.
 */

import { execSync } from 'child_process';
import os from 'os';
import fs from 'fs';
import { createLogger } from '@chiba/shared';
import type { HardwareMetrics, DiskUsage } from '@chiba/shared';
import { getMediaDir } from './content-cache.js';

const logger = createLogger('node', 'hardware');

/**
 * Get CPU temperature (Raspberry Pi specific).
 * Uses vcgencmd on Pi, falls back to thermal zone on other Linux.
 * On macOS, uses powermetrics if available, otherwise returns null indicator.
 */
export function getCpuTemp(): number {
  try {
    // Try Raspberry Pi vcgencmd first
    const output = execSync('vcgencmd measure_temp 2>/dev/null', { encoding: 'utf-8' });
    const match = output.match(/temp=([\d.]+)/);
    if (match?.[1]) {
      return parseFloat(match[1]);
    }
  } catch {
    // Not a Pi or vcgencmd not available
  }

  try {
    // Try Linux thermal zone
    const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8');
    return parseInt(temp, 10) / 1000;
  } catch {
    // Thermal zone not available
  }

  // macOS: CPU temp requires sudo/special tools, return -1 to indicate "not available"
  if (process.platform === 'darwin') {
    return -1; // Indicates "not available" on macOS
  }

  return 0;
}

/**
 * Get CPU usage percentage.
 * Samples CPU times and calculates usage over a short interval.
 */
export function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - (idle / total) * 100;

  return Math.round(usage * 10) / 10;
}

/**
 * Get memory usage.
 */
export function getMemoryUsage(): { used: number; total: number } {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    used: total - free,
    total,
  };
}

/**
 * Get disk usage for a path.
 */
export function getDiskUsageForPath(diskPath: string): DiskUsage {
  try {
    let output: string;
    let parts: string[];

    if (process.platform === 'darwin') {
      // macOS: df outputs in 512-byte blocks by default, use -k for kilobytes
      output = execSync(`df -k "${diskPath}" 2>/dev/null | tail -1`, { encoding: 'utf-8' });
      parts = output.trim().split(/\s+/);

      if (parts.length >= 4) {
        // macOS df -k output: Filesystem 1K-blocks Used Available Capacity ...
        const totalKb = parseInt(parts[1] ?? '0', 10);
        const usedKb = parseInt(parts[2] ?? '0', 10);
        const freeKb = parseInt(parts[3] ?? '0', 10);

        return {
          totalBytes: totalKb * 1024,
          usedBytes: usedKb * 1024,
          freeBytes: freeKb * 1024,
          mediaBytes: 0, // Will be calculated separately
        };
      }
    } else {
      // Linux: Use df -B1 for byte output
      output = execSync(`df -B1 "${diskPath}" 2>/dev/null | tail -1`, { encoding: 'utf-8' });
      parts = output.trim().split(/\s+/);

      if (parts.length >= 4) {
        const totalBytes = parseInt(parts[1] ?? '0', 10);
        const usedBytes = parseInt(parts[2] ?? '0', 10);
        const freeBytes = parseInt(parts[3] ?? '0', 10);

        return {
          totalBytes,
          usedBytes,
          freeBytes,
          mediaBytes: 0, // Will be calculated separately
        };
      }
    }
  } catch (err) {
    logger.debug('Failed to get disk usage via df', { path: diskPath });
  }

  // Fallback: use os.freemem-style approach
  return {
    totalBytes: 0,
    usedBytes: 0,
    freeBytes: 0,
    mediaBytes: 0,
  };
}

/**
 * Get size of media directory.
 */
export function getMediaDirSize(): number {
  try {
    const mediaDir = getMediaDir();
    let totalSize = 0;

    const files = fs.readdirSync(mediaDir);
    for (const file of files) {
      const filePath = `${mediaDir}/${file}`;
      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          totalSize += stats.size;
        }
      } catch {
        // Skip files we can't stat
      }
    }

    return totalSize;
  } catch {
    return 0;
  }
}

/**
 * Get complete disk usage including media directory size.
 */
export function getDiskUsage(): DiskUsage {
  const mediaDir = getMediaDir();
  const usage = getDiskUsageForPath(mediaDir);
  usage.mediaBytes = getMediaDirSize();
  return usage;
}

/**
 * Get all hardware metrics.
 */
export function getHardwareMetrics(): HardwareMetrics {
  const memory = getMemoryUsage();
  const disk = getDiskUsage();

  return {
    cpuTemp: getCpuTemp(),
    cpuUsage: getCpuUsage(),
    memoryUsed: memory.used,
    memoryTotal: memory.total,
    diskUsed: disk.usedBytes,
    diskTotal: disk.totalBytes,
  };
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Check if running on Raspberry Pi.
 */
export function isRaspberryPi(): boolean {
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
    return cpuinfo.includes('Raspberry Pi') || cpuinfo.includes('BCM');
  } catch {
    return false;
  }
}

/**
 * Get Raspberry Pi model if available.
 */
export function getRaspberryPiModel(): string | null {
  try {
    const model = fs.readFileSync('/sys/firmware/devicetree/base/model', 'utf-8');
    return model.replace(/\0/g, '').trim();
  } catch {
    return null;
  }
}
