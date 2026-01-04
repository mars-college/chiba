/**
 * Volume control service using ALSA.
 * Controls audio volume on Raspberry Pi via amixer.
 */

import { execSync } from 'child_process';
import { createLogger } from '@chiba/shared';

const logger = createLogger('node', 'volume');

/**
 * Current volume level (0-100).
 */
let currentVolume = 100;

/**
 * Get the current volume level.
 */
export function getVolume(): number {
  return currentVolume;
}

/**
 * Set the system volume.
 * @param level - Volume level from 0 to 100
 * @returns true if successful, false otherwise
 */
export function setVolume(level: number): boolean {
  // Clamp to 0-100 range
  const clampedLevel = Math.min(100, Math.max(0, Math.round(level)));
  currentVolume = clampedLevel;

  logger.debug('Setting volume', { level: clampedLevel });

  try {
    // Try common ALSA device names in order of preference
    const devices = ['PCM', 'Master', 'Headphone', 'Speaker'];

    for (const device of devices) {
      try {
        execSync(`amixer set ${device} ${clampedLevel}%`, { stdio: 'ignore' });
        logger.info('Volume set', { device, level: clampedLevel });
        return true;
      } catch {
        // Try next device
      }
    }

    // Try with specific card
    try {
      execSync(`amixer -c 0 set PCM ${clampedLevel}%`, { stdio: 'ignore' });
      logger.info('Volume set', { device: 'card0:PCM', level: clampedLevel });
      return true;
    } catch {
      // Continue to next attempt
    }

    // Try with card 1 (common for USB audio)
    try {
      execSync(`amixer -c 1 set PCM ${clampedLevel}%`, { stdio: 'ignore' });
      logger.info('Volume set', { device: 'card1:PCM', level: clampedLevel });
      return true;
    } catch {
      // Continue to error
    }

    // Only log on first failure - expected to fail on non-Linux systems
    logger.debug('ALSA volume control not available (expected on non-Linux systems)');
    return false;
  } catch (err) {
    logger.error('Volume control error', err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}

/**
 * Mute the audio (set volume to 0).
 */
export function mute(): boolean {
  return setVolume(0);
}

/**
 * Unmute the audio (restore to previous volume or 100).
 */
export function unmute(level = 100): boolean {
  return setVolume(level);
}

/**
 * Increase volume by a step amount.
 */
export function volumeUp(step = 10): boolean {
  return setVolume(currentVolume + step);
}

/**
 * Decrease volume by a step amount.
 */
export function volumeDown(step = 10): boolean {
  return setVolume(currentVolume - step);
}

/**
 * Check if amixer is available.
 */
export function isAmixerAvailable(): boolean {
  try {
    execSync('which amixer', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available audio devices.
 */
export function getAudioDevices(): string[] {
  try {
    const output = execSync('amixer scontrols', { encoding: 'utf-8' });
    const matches = output.matchAll(/Simple mixer control '([^']+)'/g);
    return Array.from(matches, m => m[1]).filter((d): d is string => d !== undefined);
  } catch {
    return [];
  }
}
