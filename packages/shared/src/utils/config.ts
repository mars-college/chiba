/**
 * Configuration loaders for Chiba.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LightsConfig } from '../types/lights.js';

/**
 * Get the path to the config directory.
 */
function getConfigDir(): string {
  // In ESM, we need to derive __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Config is at ../config relative to utils (in dist or src)
  return path.join(__dirname, '..', 'config');
}

/**
 * Load the lights configuration from lights.json.
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadLightsConfig(): LightsConfig | null {
  try {
    const configPath = path.join(getConfigDir(), 'lights.json');
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as LightsConfig;
  } catch (err) {
    return null;
  }
}
