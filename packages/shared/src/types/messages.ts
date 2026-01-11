/**
 * WebSocket message types for Chiba digital signage system.
 * Defines the protocol for real-time communication between components.
 */

import type { NodeConfig, NodeInfo, NodeStatus } from './node.js';
import type { PlaybackCommand, PlaybackState } from './playback.js';
import type { ContentSource } from './content.js';

// ============================================================================
// Controller <-> Node Messages
// ============================================================================

/**
 * Command message from controller to node.
 */
export interface ControllerCommandMessage {
  type: 'command';
  /** Playback command to execute */
  command: PlaybackCommand;
  /** Request ID for tracking responses */
  requestId?: string;
}

/**
 * Preload message from controller to node.
 */
export interface ControllerPreloadMessage {
  type: 'preload';
  /** Content sources to download in background */
  content: ContentSource[];
}

/**
 * Ping message from controller to node.
 */
export interface ControllerPingMessage {
  type: 'ping';
  /** Timestamp for latency measurement */
  timestamp: number;
}

/**
 * Configuration update from controller to node.
 */
export interface ControllerConfigMessage {
  type: 'config';
  /** Updated configuration values */
  config: Partial<NodeConfig>;
}

/**
 * Union of all messages from controller to node.
 */
export type ControllerToNodeMessage =
  | ControllerCommandMessage
  | ControllerPreloadMessage
  | ControllerPingMessage
  | ControllerConfigMessage;

/**
 * Registration message from node to controller.
 */
export interface NodeRegisterMessage {
  type: 'register';
  /** Node configuration */
  config: NodeConfig;
  /** Node information */
  info: NodeInfo;
}

/**
 * Heartbeat message from node to controller.
 */
export interface NodeHeartbeatMessage {
  type: 'heartbeat';
  /** Full node status */
  status: NodeStatus;
}

/**
 * State update message from node to controller.
 */
export interface NodeStateMessage {
  type: 'state';
  /** Current playback state */
  playback: PlaybackState;
  /** Response to a specific request */
  requestId?: string;
}

/** Task status for async operations */
export type TaskStatus = 'queued' | 'started' | 'downloading' | 'processing' | 'completed' | 'error';

/** Task type for async operations */
export type TaskType = 'cache' | 'youtube' | 'eden';

/** Result data for completed tasks */
export interface TaskResult {
  filename?: string;
  hash?: string;
  sizeBytes?: number;
  alreadyCached?: boolean;
  /** For Eden collections */
  itemsTotal?: number;
  itemsDownloaded?: number;
  itemsSkipped?: number;
  itemsFailed?: number;
}

/** Error details for failed tasks */
export interface TaskError {
  code: string;
  message: string;
}

/**
 * Download progress message from node to controller.
 * Enhanced to support async task tracking with full progress reporting.
 */
export interface NodeDownloadProgressMessage {
  type: 'download_progress';
  /** Unique task identifier */
  taskId: string;
  /** Node ID sending this progress */
  nodeId: string;
  /** Type of task being executed */
  taskType: TaskType;
  /** Current task status */
  status: TaskStatus;
  /** Content hash being downloaded (optional, may not be known until download starts) */
  hash?: string;
  /** Download progress (0-100) */
  progress: number;
  /** Total size in bytes */
  totalBytes?: number;
  /** Downloaded bytes so far */
  downloadedBytes?: number;
  /** Human-readable status message */
  message?: string;
  /** Result data on completion */
  result?: TaskResult;
  /** Error details if status is 'error' */
  error?: TaskError;
}

/**
 * Pong response to controller ping.
 */
export interface NodePongMessage {
  type: 'pong';
  /** Echo of the ping timestamp */
  timestamp: number;
}

/**
 * Error message from node to controller.
 */
export interface NodeErrorMessage {
  type: 'error';
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Related request ID if applicable */
  requestId?: string;
}

/**
 * Union of all messages from node to controller.
 */
export type NodeToControllerMessage =
  | NodeRegisterMessage
  | NodeHeartbeatMessage
  | NodeStateMessage
  | NodeDownloadProgressMessage
  | NodePongMessage
  | NodeErrorMessage;

// ============================================================================
// Node <-> Player Messages (Local WebSocket)
// ============================================================================

/**
 * Ready message from player to node.
 */
export interface PlayerReadyMessage {
  type: 'ready';
}

/**
 * Ended message from player to node when content finishes.
 */
export interface PlayerEndedMessage {
  type: 'ended';
}

/**
 * Intro complete message from player to node.
 */
export interface PlayerIntroCompleteMessage {
  type: 'intro_complete';
}

/**
 * Error message from player to node.
 */
export interface PlayerErrorMessage {
  type: 'error';
  /** Error message */
  error: string;
}

/**
 * User interaction message from player (e.g., click for audio).
 */
export interface PlayerInteractionMessage {
  type: 'interaction';
  /** Type of interaction */
  interaction: 'click' | 'keypress';
}

/**
 * Union of all messages from player to node.
 */
export type PlayerToNodeMessage =
  | PlayerReadyMessage
  | PlayerEndedMessage
  | PlayerIntroCompleteMessage
  | PlayerErrorMessage
  | PlayerInteractionMessage;

/**
 * State message from node to player.
 */
export interface NodeToPlayerStateMessage {
  type: 'state';
  /** Current playback state */
  playback: PlaybackState;
}

/**
 * Preload message from node to player.
 */
export interface NodeToPlayerPreloadMessage {
  type: 'preload';
  /** URLs to preload in browser */
  urls: string[];
}

/**
 * Union of all messages from node to player.
 */
export type NodeToPlayerMessage =
  | NodeToPlayerStateMessage
  | NodeToPlayerPreloadMessage;

// ============================================================================
// Controller <-> Dashboard Messages
// ============================================================================

/**
 * Full nodes list message from controller to dashboard.
 */
export interface DashboardNodesMessage {
  type: 'nodes';
  /** List of all node statuses */
  nodes: NodeStatus[];
}

/**
 * Single node update message from controller to dashboard.
 */
export interface DashboardNodeUpdateMessage {
  type: 'node_update';
  /** ID of updated node */
  nodeId: string;
  /** Updated status */
  status: NodeStatus;
}

/**
 * Node disconnected message from controller to dashboard.
 */
export interface DashboardNodeDisconnectedMessage {
  type: 'node_disconnected';
  /** ID of disconnected node */
  nodeId: string;
}

/**
 * Task progress message from controller to dashboard.
 * Forwards download/cache progress from nodes to connected dashboards.
 */
export interface DashboardTaskProgressMessage {
  type: 'task_progress';
  /** Node ID where task is running */
  nodeId: string;
  /** Task progress details */
  task: NodeDownloadProgressMessage;
}

/**
 * Union of all messages from controller to dashboard.
 */
export type ControllerToDashboardMessage =
  | DashboardNodesMessage
  | DashboardNodeUpdateMessage
  | DashboardNodeDisconnectedMessage
  | DashboardTaskProgressMessage;

/**
 * Command message from dashboard to controller.
 */
export interface DashboardCommandMessage {
  type: 'command';
  /** Target node ID */
  nodeId: string;
  /** Command to execute */
  command: PlaybackCommand;
}

/**
 * Subscribe message from dashboard to controller.
 */
export interface DashboardSubscribeMessage {
  type: 'subscribe';
  /** Node IDs to subscribe to (empty for all) */
  nodeIds?: string[];
}

/**
 * Union of all messages from dashboard to controller.
 */
export type DashboardToControllerMessage =
  | DashboardCommandMessage
  | DashboardSubscribeMessage;

// ============================================================================
// Message Parsing Utilities
// ============================================================================

/**
 * Parse a JSON message string into a typed message.
 * Returns null if parsing fails.
 */
export function parseMessage<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Serialize a message to JSON string.
 */
export function serializeMessage<T>(message: T): string {
  return JSON.stringify(message);
}
