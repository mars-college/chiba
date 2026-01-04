/**
 * Volume service tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';

// Mock child_process before importing volume
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Now import the module under test
import {
  getVolume,
  setVolume,
  mute,
  unmute,
  volumeUp,
  volumeDown,
  isAmixerAvailable,
  getAudioDevices,
} from '../../services/volume.js';

describe('volume service', () => {
  const mockExecSync = execSync as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset volume to 100 for next tests
    mockExecSync.mockImplementation(() => '');
    setVolume(100);
  });

  describe('getVolume', () => {
    it('should return current volume level', () => {
      const volume = getVolume();
      expect(typeof volume).toBe('number');
      expect(volume).toBeGreaterThanOrEqual(0);
      expect(volume).toBeLessThanOrEqual(100);
    });
  });

  describe('setVolume', () => {
    it('should set volume and return true on success', () => {
      mockExecSync.mockImplementation(() => '');

      const result = setVolume(75);

      expect(result).toBe(true);
      expect(getVolume()).toBe(75);
    });

    it('should clamp volume to 0-100 range', () => {
      mockExecSync.mockImplementation(() => '');

      setVolume(150);
      expect(getVolume()).toBe(100);

      setVolume(-50);
      expect(getVolume()).toBe(0);
    });

    it('should round volume to nearest integer', () => {
      mockExecSync.mockImplementation(() => '');

      setVolume(75.6);
      expect(getVolume()).toBe(76);

      setVolume(75.4);
      expect(getVolume()).toBe(75);
    });

    it('should try multiple ALSA devices', () => {
      // First few devices fail, then one succeeds
      let callCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        callCount++;
        if (cmd.includes('Master')) {
          return '';
        }
        throw new Error('Device not found');
      });

      const result = setVolume(50);

      expect(result).toBe(true);
      expect(callCount).toBeGreaterThan(1);
    });

    it('should return false when no devices work', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('No audio devices');
      });

      const result = setVolume(50);

      expect(result).toBe(false);
    });
  });

  describe('mute', () => {
    it('should set volume to 0', () => {
      mockExecSync.mockImplementation(() => '');

      mute();

      expect(getVolume()).toBe(0);
    });
  });

  describe('unmute', () => {
    it('should restore volume to default (100)', () => {
      mockExecSync.mockImplementation(() => '');

      mute();
      unmute();

      expect(getVolume()).toBe(100);
    });

    it('should restore volume to specified level', () => {
      mockExecSync.mockImplementation(() => '');

      mute();
      unmute(80);

      expect(getVolume()).toBe(80);
    });
  });

  describe('volumeUp', () => {
    it('should increase volume by default step (10)', () => {
      mockExecSync.mockImplementation(() => '');
      setVolume(50);

      volumeUp();

      expect(getVolume()).toBe(60);
    });

    it('should increase volume by custom step', () => {
      mockExecSync.mockImplementation(() => '');
      setVolume(50);

      volumeUp(25);

      expect(getVolume()).toBe(75);
    });

    it('should cap at 100', () => {
      mockExecSync.mockImplementation(() => '');
      setVolume(95);

      volumeUp();

      expect(getVolume()).toBe(100);
    });
  });

  describe('volumeDown', () => {
    it('should decrease volume by default step (10)', () => {
      mockExecSync.mockImplementation(() => '');
      setVolume(50);

      volumeDown();

      expect(getVolume()).toBe(40);
    });

    it('should decrease volume by custom step', () => {
      mockExecSync.mockImplementation(() => '');
      setVolume(50);

      volumeDown(25);

      expect(getVolume()).toBe(25);
    });

    it('should floor at 0', () => {
      mockExecSync.mockImplementation(() => '');
      setVolume(5);

      volumeDown();

      expect(getVolume()).toBe(0);
    });
  });

  describe('isAmixerAvailable', () => {
    it('should return true when amixer is found', () => {
      mockExecSync.mockImplementation(() => '/usr/bin/amixer');

      expect(isAmixerAvailable()).toBe(true);
    });

    it('should return false when amixer is not found', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(isAmixerAvailable()).toBe(false);
    });
  });

  describe('getAudioDevices', () => {
    it('should parse amixer output for device names', () => {
      mockExecSync.mockImplementation(() =>
        "Simple mixer control 'PCM',0\nSimple mixer control 'Master',0\nSimple mixer control 'Headphone',0"
      );

      const devices = getAudioDevices();

      expect(devices).toEqual(['PCM', 'Master', 'Headphone']);
    });

    it('should return empty array on error', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('amixer failed');
      });

      const devices = getAudioDevices();

      expect(devices).toEqual([]);
    });
  });
});
