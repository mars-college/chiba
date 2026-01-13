/**
 * Node types for Chiba digital signage system.
 * Defines the structure of Pi nodes, their configuration, and status.
 */

/**
 * Configuration stored on each Pi node.
 * This is persisted locally and used for controller registration.
 */
export interface NodeConfig {
  /** Auto-generated UUID for this node */
  id: string;
  /** Human-readable name, e.g., "living-room", "bedroom" */
  friendlyName: string;
  /** URL of the controller to register with */
  controllerUrl: string;
  /** Optional per-node API key for authentication */
  apiKey?: string;
}

/**
 * Display rotation values in degrees.
 */
export type DisplayRotation = 0 | 90 | 180 | 270;

/**
 * Basic information about a node, sent during registration.
 */
export interface NodeInfo {
  /** Node's unique identifier */
  id: string;
  /** Human-readable name */
  friendlyName: string;
  /** System hostname, e.g., "raspberrypi" */
  hostname: string;
  /** Current IP address */
  ip: string;
  /** HTTP server port (default: 8080) */
  port: number;
  /** Chiba version running on this node */
  version: string;
  /** Uptime in seconds */
  uptime: number;
  /** Display rotation in degrees (0, 90, 180, 270) */
  displayRotation?: DisplayRotation;
}

/**
 * Disk usage information for a node.
 */
export interface DiskUsage {
  /** Total disk space in bytes */
  totalBytes: number;
  /** Used disk space in bytes */
  usedBytes: number;
  /** Free disk space in bytes */
  freeBytes: number;
  /** Size of the media directory in bytes */
  mediaBytes: number;
}

/**
 * Hardware metrics for monitoring node health.
 */
export interface HardwareMetrics {
  /** CPU temperature in Celsius */
  cpuTemp: number;
  /** CPU usage percentage (0-100) */
  cpuUsage: number;
  /** Used memory in bytes */
  memoryUsed: number;
  /** Total memory in bytes */
  memoryTotal: number;
  /** Used disk space in bytes */
  diskUsed: number;
  /** Total disk space in bytes */
  diskTotal: number;
}

/**
 * Summary of cached content on a node.
 */
export interface ContentSummary {
  /** MD5 hash of the file content (used as filename without extension) */
  hash: string;
  /** Full filename including extension */
  filename: string;
  /** User-friendly display name */
  name?: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Content type */
  type: 'video' | 'image';
  /** Unix timestamp when the file was cached */
  cachedAt: number;
}

/**
 * Summary of a playlist item for display purposes.
 */
export interface PlaylistItemSummary {
  /** Item ID */
  id: string;
  /** Display name */
  name?: string;
  /** Content type (video/image) */
  type?: 'video' | 'image';
  /** Size in bytes (if resolved) */
  sizeBytes?: number;
  /** Whether content is cached locally */
  isCached: boolean;
  /** Filename if cached */
  filename?: string;
}

/**
 * Summary of a cached playlist on a node.
 */
export interface PlaylistSummary {
  /** Unique ID for this playlist */
  id: string;
  /** Human-readable playlist name */
  name: string;
  /** Number of items in the playlist */
  itemCount: number;
  /** Total size of all resolved/cached content in bytes */
  totalSizeBytes: number;
  /** Whether to loop when reaching the end */
  loop: boolean;
  /** Whether to show intro screens between items */
  showIntros: boolean;
  /** Unix timestamp when created */
  createdAt: number;
  /** Unix timestamp when last modified */
  updatedAt: number;
  /** Unix timestamp when last played (if ever) */
  lastPlayedAt?: number;
  /** Items in the playlist (for expansion in UI) */
  items: PlaylistItemSummary[];
}

// Import PlaybackState from playback.ts to avoid circular dependency
import type { PlaybackState } from './playback.js';

/**
 * Full status of a node, including connection state and current playback.
 */
export interface NodeStatus {
  /** Basic node information */
  node: NodeInfo;
  /** Whether the node is currently connected to the controller */
  connected: boolean;
  /** Unix timestamp of last heartbeat */
  lastSeen: number;
  /** Current playback state */
  playbackState: PlaybackState;
  /** List of cached content */
  cachedContent: ContentSummary[];
  /** List of cached playlists */
  cachedPlaylists: PlaylistSummary[];
  /** Disk usage information */
  diskUsage: DiskUsage;
  /** Hardware metrics (optional, may not be available on all platforms) */
  hardware?: HardwareMetrics;
}

/**
 * Node registration request sent to controller on boot.
 */
export interface RegisterNodeRequest {
  /** Human-readable name for this node */
  friendlyName: string;
  /** System hostname */
  hostname: string;
  /** Current IP address */
  ip: string;
  /** HTTP server port */
  port: number;
  /** Chiba version */
  version: string;
}

/**
 * Controller's response to node registration.
 */
export interface RegisterNodeResponse {
  /** Assigned or confirmed node ID */
  id: string;
  /** API key for authenticating future requests */
  apiKey: string;
}
