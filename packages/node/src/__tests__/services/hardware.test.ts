/**
 * Hardware metrics service tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

// Mock dependencies
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  },
}));

vi.mock('os', () => ({
  default: {
    cpus: vi.fn(),
    totalmem: vi.fn(),
    freemem: vi.fn(),
  },
}));

vi.mock('../../services/content-cache.js', () => ({
  getMediaDir: vi.fn(() => '/tmp/chiba-media'),
}));

import {
  getCpuTemp,
  getCpuUsage,
  getMemoryUsage,
  getDiskUsageForPath,
  getMediaDirSize,
  getDiskUsage,
  getHardwareMetrics,
  formatBytes,
  isRaspberryPi,
  getRaspberryPiModel,
} from '../../services/hardware.js';

describe('hardware service', () => {
  const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;
  const mockFs = fs as unknown as {
    readFileSync: ReturnType<typeof vi.fn>;
    readdirSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
  };
  const mockOs = os as unknown as {
    cpus: ReturnType<typeof vi.fn>;
    totalmem: ReturnType<typeof vi.fn>;
    freemem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCpuTemp', () => {
    it('should read temperature from vcgencmd on Raspberry Pi', () => {
      mockExecSync.mockReturnValue("temp=45.2'C\n");

      const temp = getCpuTemp();

      expect(temp).toBe(45.2);
    });

    it('should fall back to thermal zone on Linux', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('vcgencmd not found');
      });
      mockFs.readFileSync.mockReturnValue('52000');

      const temp = getCpuTemp();

      expect(temp).toBe(52);
    });

    it('should return 0 when no temperature source available', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('vcgencmd not found');
      });
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('thermal zone not found');
      });

      const temp = getCpuTemp();

      expect(temp).toBe(0);
    });
  });

  describe('getCpuUsage', () => {
    it('should calculate CPU usage from os.cpus()', () => {
      mockOs.cpus.mockReturnValue([
        { times: { user: 1000, nice: 100, sys: 200, idle: 700, irq: 0 } },
        { times: { user: 1000, nice: 100, sys: 200, idle: 700, irq: 0 } },
      ]);

      const usage = getCpuUsage();

      // (2000 total - 1400 idle) / 2000 = 30%
      expect(usage).toBeGreaterThan(0);
      expect(usage).toBeLessThanOrEqual(100);
    });
  });

  describe('getMemoryUsage', () => {
    it('should return memory used and total', () => {
      mockOs.totalmem.mockReturnValue(4 * 1024 * 1024 * 1024); // 4GB
      mockOs.freemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB

      const memory = getMemoryUsage();

      expect(memory.total).toBe(4 * 1024 * 1024 * 1024);
      expect(memory.used).toBe(3 * 1024 * 1024 * 1024);
    });
  });

  describe('getDiskUsageForPath', () => {
    it('should parse df output correctly', () => {
      mockExecSync.mockReturnValue('/dev/sda1 500000000000 250000000000 250000000000 50% /');

      const usage = getDiskUsageForPath('/');

      expect(usage.totalBytes).toBe(500000000000);
      expect(usage.usedBytes).toBe(250000000000);
      expect(usage.freeBytes).toBe(250000000000);
    });

    it('should return zeros on error', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('df failed');
      });

      const usage = getDiskUsageForPath('/nonexistent');

      expect(usage.totalBytes).toBe(0);
      expect(usage.usedBytes).toBe(0);
      expect(usage.freeBytes).toBe(0);
    });
  });

  describe('getMediaDirSize', () => {
    it('should sum file sizes in media directory', () => {
      mockFs.readdirSync.mockReturnValue(['video1.mp4', 'video2.mp4']);
      mockFs.statSync
        .mockReturnValueOnce({ isFile: () => true, size: 100000000 })
        .mockReturnValueOnce({ isFile: () => true, size: 200000000 });

      const size = getMediaDirSize();

      expect(size).toBe(300000000);
    });

    it('should skip directories', () => {
      mockFs.readdirSync.mockReturnValue(['video.mp4', 'subdir']);
      mockFs.statSync
        .mockReturnValueOnce({ isFile: () => true, size: 100000000 })
        .mockReturnValueOnce({ isFile: () => false, size: 0 });

      const size = getMediaDirSize();

      expect(size).toBe(100000000);
    });

    it('should return 0 on error', () => {
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('directory not found');
      });

      const size = getMediaDirSize();

      expect(size).toBe(0);
    });
  });

  describe('getDiskUsage', () => {
    it('should include media directory size', () => {
      mockExecSync.mockReturnValue('/dev/sda1 500000000000 250000000000 250000000000 50% /');
      mockFs.readdirSync.mockReturnValue(['video.mp4']);
      mockFs.statSync.mockReturnValue({ isFile: () => true, size: 100000000 });

      const usage = getDiskUsage();

      expect(usage.mediaBytes).toBe(100000000);
    });
  });

  describe('getHardwareMetrics', () => {
    it('should return all metrics', () => {
      mockExecSync.mockReturnValue("temp=45.0'C\n");
      mockOs.cpus.mockReturnValue([
        { times: { user: 1000, nice: 0, sys: 200, idle: 800, irq: 0 } },
      ]);
      mockOs.totalmem.mockReturnValue(4294967296);
      mockOs.freemem.mockReturnValue(2147483648);
      mockFs.readdirSync.mockReturnValue([]);

      const metrics = getHardwareMetrics();

      expect(metrics).toHaveProperty('cpuTemp');
      expect(metrics).toHaveProperty('cpuUsage');
      expect(metrics).toHaveProperty('memoryUsed');
      expect(metrics).toHaveProperty('memoryTotal');
      expect(metrics).toHaveProperty('diskUsed');
      expect(metrics).toHaveProperty('diskTotal');
    });
  });

  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1099511627776)).toBe('1 TB');
    });
  });

  describe('isRaspberryPi', () => {
    it('should return true for Raspberry Pi', () => {
      mockFs.readFileSync.mockReturnValue('Raspberry Pi 4 Model B');

      expect(isRaspberryPi()).toBe(true);
    });

    it('should return true for BCM processor', () => {
      mockFs.readFileSync.mockReturnValue('Hardware: BCM2835');

      expect(isRaspberryPi()).toBe(true);
    });

    it('should return false for non-Pi', () => {
      mockFs.readFileSync.mockReturnValue('Intel Core i7');

      expect(isRaspberryPi()).toBe(false);
    });

    it('should return false on error', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('file not found');
      });

      expect(isRaspberryPi()).toBe(false);
    });
  });

  describe('getRaspberryPiModel', () => {
    it('should return Pi model', () => {
      mockFs.readFileSync.mockReturnValue('Raspberry Pi 4 Model B Rev 1.4\0');

      expect(getRaspberryPiModel()).toBe('Raspberry Pi 4 Model B Rev 1.4');
    });

    it('should return null on non-Pi', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('file not found');
      });

      expect(getRaspberryPiModel()).toBe(null);
    });
  });
});
