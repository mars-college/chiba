/**
 * Type exports for Chiba digital signage system.
 */

// Node types
export type {
  NodeConfig,
  NodeInfo,
  NodeStatus,
  DiskUsage,
  HardwareMetrics,
  ContentSummary,
  RegisterNodeRequest,
  RegisterNodeResponse,
} from './node.js';

// Content types
export type {
  ContentSourceType,
  FileSource,
  UrlSource,
  YouTubeSource,
  EdenSource,
  EdenCollectionSource,
  EdenCreationSource,
  ContentSource,
  ContentType,
  ContentMetadata,
  Content,
  PlaylistItem,
  Playlist,
  CacheRequest,
  CacheResponse,
} from './content.js';

export {
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  getContentType,
} from './content.js';

// Playback types
export type {
  PlaybackMode,
  PlaybackState,
  PlaybackAction,
  PlayPayload,
  SeekPayload,
  VolumePayload,
  PlaybackCommand,
  PlayRequest,
  VolumeRequest,
  PlaybackResponse,
} from './playback.js';

export { DEFAULT_PLAYBACK_STATE } from './playback.js';

// Message types
export type {
  // Controller -> Node
  ControllerCommandMessage,
  ControllerPreloadMessage,
  ControllerPingMessage,
  ControllerConfigMessage,
  ControllerToNodeMessage,
  // Node -> Controller
  NodeRegisterMessage,
  NodeHeartbeatMessage,
  NodeStateMessage,
  NodeDownloadProgressMessage,
  NodePongMessage,
  NodeErrorMessage,
  NodeToControllerMessage,
  // Player -> Node
  PlayerReadyMessage,
  PlayerEndedMessage,
  PlayerIntroCompleteMessage,
  PlayerErrorMessage,
  PlayerInteractionMessage,
  PlayerToNodeMessage,
  // Node -> Player
  NodeToPlayerStateMessage,
  NodeToPlayerPreloadMessage,
  NodeToPlayerMessage,
  // Controller -> Dashboard
  DashboardNodesMessage,
  DashboardNodeUpdateMessage,
  DashboardNodeDisconnectedMessage,
  ControllerToDashboardMessage,
  // Dashboard -> Controller
  DashboardCommandMessage,
  DashboardSubscribeMessage,
  DashboardToControllerMessage,
} from './messages.js';

export { parseMessage, serializeMessage } from './messages.js';

// API types
export type {
  ApiResponse,
  PaginationParams,
  PaginatedResponse,
  ListNodesResponse,
  GetNodeResponse,
  UpdateNodeRequest,
  NodePlayRequest,
  NodeCacheRequest,
  ListContentResponse,
  ListPlaylistsResponse,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  ServiceInfoResponse,
  StatusResponse,
  ListFilesResponse,
  DebugResponse,
  CacheContentRequest,
  CacheContentResponse,
  PlayContentRequest,
  SetVolumeRequest,
} from './api.js';
