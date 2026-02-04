/**
 * Constants for Chiba digital signage system.
 */

/**
 * Default port for HTTP servers.
 */
export const DEFAULT_PORT = 8080;

/**
 * Default heartbeat interval in milliseconds.
 */
export const HEARTBEAT_INTERVAL = 10000; // 10 seconds

/**
 * Default timeout for considering a node offline.
 */
export const NODE_OFFLINE_TIMEOUT = 30000; // 30 seconds

/**
 * Alias for NODE_OFFLINE_TIMEOUT for convenience.
 */
export const NODE_TIMEOUT = NODE_OFFLINE_TIMEOUT;

/**
 * Default intro screen duration in milliseconds.
 */
export const DEFAULT_INTRO_DURATION = 5000; // 5 seconds

/**
 * Minimum intro screen duration in milliseconds.
 */
export const MIN_INTRO_DURATION = 2000; // 2 seconds

/**
 * Maximum intro screen duration in milliseconds.
 */
export const MAX_INTRO_DURATION = 20000; // 20 seconds

/**
 * Threshold above which black screen padding is added before/after intro.
 * At or above this duration, 20% padding is added.
 */
export const INTRO_PADDING_THRESHOLD = 5000; // 5 seconds

/**
 * Percentage of intro duration to use as black screen padding.
 */
export const INTRO_PADDING_PERCENT = 0.2; // 20%

/**
 * Default image display duration in milliseconds (for playlists).
 */
export const DEFAULT_IMAGE_DURATION = 10000; // 10 seconds

/**
 * Minimum image display duration in milliseconds.
 */
export const MIN_IMAGE_DURATION = 5000; // 5 seconds

/**
 * Maximum image display duration in milliseconds.
 */
export const MAX_IMAGE_DURATION = 120000; // 2 minutes

/**
 * Default volume level (0-100).
 */
export const DEFAULT_VOLUME = 100;

/**
 * Hardware metrics collection interval in milliseconds.
 */
export const METRICS_INTERVAL = 30000; // 30 seconds

/**
 * Download timeout in milliseconds.
 */
export const DOWNLOAD_TIMEOUT = 300000; // 5 minutes

/**
 * WebSocket reconnect delay in milliseconds.
 */
export const WS_RECONNECT_DELAY = 1000; // 1 second

/**
 * Maximum WebSocket payload size in bytes.
 */
export const WS_MAX_PAYLOAD = 1024 * 1024; // 1 MB

/**
 * Media directory name.
 */
export const MEDIA_DIR = 'media';

/**
 * Database filename.
 */
export const DB_FILENAME = 'chiba.db';

/**
 * Chiba version.
 */
export const VERSION = '0.1.0';

/**
 * Eden API endpoints.
 */
export const EDEN_API = {
  PROD: 'https://api.eden.art',
  STAGE: 'https://staging.api.eden.art',
} as const;

/**
 * YouTube download quality limit.
 */
export const YOUTUBE_MAX_HEIGHT = 1080;

/**
 * Log levels.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Environment variable names.
 */
export const ENV = {
  PORT: 'PORT',
  LOG_LEVEL: 'LOG_LEVEL',
  API_KEY: 'API_KEY',
  CONTROLLER_URL: 'CONTROLLER_URL',
  EDEN_API_KEY: 'EDEN_API_KEY',
  NODE_NAME: 'NODE_NAME',
  NODE_ID: 'NODE_ID',
  MEDIA_DIR: 'MEDIA_DIR',
  DB_PATH: 'DB_PATH',
  GOVEE_API_KEY: 'GOVEE_API_KEY',
  GOVEE_FILTER: 'GOVEE_FILTER',
} as const;
