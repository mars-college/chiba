/**
 * API types for Chiba digital signage system.
 * Defines request/response types for REST endpoints.
 */

import type { NodeInfo, NodeStatus, RegisterNodeRequest, RegisterNodeResponse } from './node.js';
import type { Content, ContentSource, Playlist, CacheRequest, CacheResponse, ContentMetadata } from './content.js';
import type { PlaybackState, PlayRequest, VolumeRequest, PlaybackResponse } from './playback.js';

// ============================================================================
// Common API Types
// ============================================================================

/**
 * Standard API response wrapper.
 */
export interface ApiResponse<T = unknown> {
  /** Whether the request succeeded */
  success: boolean;
  /** Response data if successful */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  code?: string;
}

/**
 * Pagination parameters for list endpoints.
 */
export interface PaginationParams {
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page */
  limit?: number;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  /** List of items */
  items: T[];
  /** Total number of items */
  total: number;
  /** Current page number */
  page: number;
  /** Items per page */
  limit: number;
  /** Whether there are more pages */
  hasMore: boolean;
}

// ============================================================================
// Controller API Types
// ============================================================================

/**
 * GET /api/nodes response
 */
export interface ListNodesResponse {
  nodes: NodeStatus[];
}

/**
 * GET /api/nodes/:id response
 */
export interface GetNodeResponse {
  node: NodeStatus;
}

/**
 * PUT /api/nodes/:id request
 */
export interface UpdateNodeRequest {
  /** New friendly name */
  friendlyName?: string;
}

/**
 * POST /api/nodes/:id/play request
 */
export type NodePlayRequest = PlayRequest;

/**
 * POST /api/nodes/:id/cache request
 */
export interface NodeCacheRequest {
  /** Content sources to cache */
  sources: ContentSource[];
  /** Metadata to store with content */
  metadata?: ContentMetadata;
}

/**
 * GET /api/content response
 */
export interface ListContentResponse {
  content: Content[];
}

/**
 * GET /api/playlists response
 */
export interface ListPlaylistsResponse {
  playlists: Playlist[];
}

/**
 * POST /api/playlists request
 */
export interface CreatePlaylistRequest {
  /** Playlist name */
  name: string;
  /** Playlist items (content sources) */
  items: ContentSource[];
  /** Whether to loop */
  loop?: boolean;
  /** Whether to show intro screens */
  showIntros?: boolean;
  /** Default intro duration in milliseconds */
  introDuration?: number;
}

/**
 * PUT /api/playlists/:id request
 */
export interface UpdatePlaylistRequest {
  /** New name */
  name?: string;
  /** New items */
  items?: ContentSource[];
  /** Whether to loop */
  loop?: boolean;
  /** Whether to show intro screens */
  showIntros?: boolean;
  /** Default intro duration in milliseconds */
  introDuration?: number;
}

// ============================================================================
// Node API Types
// ============================================================================

/**
 * GET / response (service info)
 */
export interface ServiceInfoResponse {
  /** Service name */
  name: string;
  /** Version */
  version: string;
  /** Node friendly name */
  friendlyName: string;
  /** Node ID */
  nodeId: string;
  /** Uptime in seconds */
  uptime: number;
}

/**
 * GET /status response
 */
export interface StatusResponse {
  /** Node information */
  node: NodeInfo;
  /** Current playback state */
  playback: PlaybackState;
  /** Controller connection status */
  controllerConnected: boolean;
  /** Number of connected WebSocket clients */
  wsClients: number;
}

/**
 * GET /files response
 */
export interface ListFilesResponse {
  /** List of cached files */
  files: Content[];
  /** Total size of all files */
  totalBytes: number;
  /** Number of files */
  count: number;
}

/**
 * GET /debug response (for debug screen)
 */
export interface DebugResponse {
  /** Node information */
  node: NodeInfo;
  /** Network information */
  network: {
    /** IP address */
    ip: string;
    /** Whether network is connected */
    connected: boolean;
    /** Controller URL */
    controllerUrl: string;
    /** Controller connection status */
    controllerConnected: boolean;
  };
  /** Cached content summary */
  cache: {
    /** Number of files */
    fileCount: number;
    /** Total size in bytes */
    totalBytes: number;
    /** List of files (name and size) */
    files: Array<{ filename: string; sizeBytes: number }>;
  };
  /** Current status */
  status: 'ready' | 'playing' | 'offline' | 'error';
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * POST /cache request
 */
export type CacheContentRequest = CacheRequest;

/**
 * POST /cache response
 */
export type CacheContentResponse = CacheResponse;

/**
 * POST /play request
 */
export type PlayContentRequest = PlayRequest;

/**
 * POST /volume request
 */
export type SetVolumeRequest = VolumeRequest;

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type {
  RegisterNodeRequest,
  RegisterNodeResponse,
  CacheRequest,
  CacheResponse,
  PlayRequest,
  VolumeRequest,
  PlaybackResponse,
};
