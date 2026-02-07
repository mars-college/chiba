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
  PlaylistItemSummary,
  PlaylistSummary,
  RegisterNodeRequest,
  RegisterNodeResponse,
  DisplayRotation,
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
  GDriveSource,
  UploadSource,
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
  // Task types for async operations
  TaskStatus,
  TaskType,
  TaskResult,
  TaskError,
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
  NodeContentCachedMessage,
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
  NodeToPlayerDownloadProgressMessage,
  NodeToPlayerMessage,
  // Controller -> Dashboard
  DashboardNodesMessage,
  DashboardNodeUpdateMessage,
  DashboardNodeDisconnectedMessage,
  DashboardTaskProgressMessage,
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

// Light types
export type {
  Light,
  LightState,
  LightWithState,
  PresetLightSetting,
  LightPreset,
  LightControlRequest,
  CreatePresetRequest,
  DiscoveredLight,
  DiscoveryResult,
  LightConfigEntry,
  LightsConfig,
  BreakpointTimeType,
  LightScheduleBreakpoint,
  LightSchedule,
  SetLightScheduleRequest,
} from './lights.js';

// Plug types
export type {
  Plug,
  PlugState,
  PlugWithState,
  PlugControlRequest,
  DiscoveredPlug,
  PlugDiscoveryResult,
  PlugConfigEntry,
  PlugsConfig,
  PlugScheduleBreakpoint,
  PlugSchedule,
  SetPlugScheduleRequest,
} from './plugs.js';
