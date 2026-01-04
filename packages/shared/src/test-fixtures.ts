/**
 * Test fixtures for Chiba digital signage system.
 * Contains sample data for testing various components.
 */

import type {
  NodeConfig,
  NodeInfo,
  NodeStatus,
  Content,
  Playlist,
  PlaybackState,
  ContentSource,
  DiskUsage,
  HardwareMetrics,
} from './types/index.js';
import { DEFAULT_PLAYBACK_STATE } from './types/index.js';

/**
 * Test data provided by the user.
 */
export const TEST_DATA = {
  eden: {
    prod: [
      '6526f38042a1043421aa28e8',
      '67dcf5a16959c2d364502023',
    ],
    stage: [
      '695223211dd4ee955af2cb1e',
      '6955b5ec1dd4ee955af9f612',
    ],
  },
  videos: [
    'https://d14i3advvh2bvd.cloudfront.net/243d3d3e4d30700c3868cd8651f8352d87c2d29778d24f2efd8939e506e6b98c.mp4',
  ],
  images: [
    'https://edenartlab-prod-data.s3.us-east-1.amazonaws.com/bb88e857586a358ce3f02f92911588207fbddeabff62a3d6a479517a646f053c.jpg',
  ],
  youtube: [
    'https://www.youtube.com/watch?v=NJOJTsmJLLA',
  ],
} as const;

/**
 * Sample node configuration.
 */
export const SAMPLE_NODE_CONFIG: NodeConfig = {
  id: 'test-node-001',
  friendlyName: 'living-room',
  controllerUrl: 'http://localhost:8080',
  apiKey: 'test-api-key-12345',
};

/**
 * Sample node info.
 */
export const SAMPLE_NODE_INFO: NodeInfo = {
  id: 'test-node-001',
  friendlyName: 'living-room',
  hostname: 'raspberrypi',
  ip: '192.168.1.100',
  port: 8080,
  version: '2.0.0',
  uptime: 3600,
};

/**
 * Sample disk usage.
 */
export const SAMPLE_DISK_USAGE: DiskUsage = {
  totalBytes: 32000000000, // 32 GB
  usedBytes: 16000000000,  // 16 GB
  freeBytes: 16000000000,  // 16 GB
  mediaBytes: 2000000000,  // 2 GB
};

/**
 * Sample hardware metrics.
 */
export const SAMPLE_HARDWARE_METRICS: HardwareMetrics = {
  cpuTemp: 55.0,
  cpuUsage: 25.5,
  memoryUsed: 512000000,   // 512 MB
  memoryTotal: 4000000000, // 4 GB
  diskUsed: 16000000000,   // 16 GB
  diskTotal: 32000000000,  // 32 GB
};

/**
 * Sample content item.
 */
export const SAMPLE_CONTENT: Content = {
  id: 'content-001',
  hash: 'a1b2c3d4e5f6g7h8i9j0',
  filename: 'a1b2c3d4e5f6g7h8i9j0.mp4',
  originalUrl: TEST_DATA.videos[0],
  source: { type: 'url', url: TEST_DATA.videos[0] ?? '' },
  type: 'video',
  sizeBytes: 50000000, // 50 MB
  duration: 120,
  width: 1920,
  height: 1080,
  metadata: {
    title: 'Test Video',
    author: 'Test Author',
  },
  createdAt: Date.now(),
  lastPlayedAt: Date.now(),
};

/**
 * Sample image content.
 */
export const SAMPLE_IMAGE_CONTENT: Content = {
  id: 'content-002',
  hash: 'b2c3d4e5f6g7h8i9j0k1',
  filename: 'b2c3d4e5f6g7h8i9j0k1.jpg',
  originalUrl: TEST_DATA.images[0],
  source: { type: 'url', url: TEST_DATA.images[0] ?? '' },
  type: 'image',
  sizeBytes: 2000000, // 2 MB
  width: 1920,
  height: 1080,
  createdAt: Date.now(),
};

/**
 * Sample playlist.
 */
export const SAMPLE_PLAYLIST: Playlist = {
  id: 'playlist-001',
  name: 'Test Playlist',
  items: [
    { id: 'item-1', content: SAMPLE_CONTENT, order: 0 },
    { id: 'item-2', content: SAMPLE_IMAGE_CONTENT, duration: 5000, order: 1 },
  ],
  loop: true,
  showIntros: true,
  introDuration: 3000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Sample playback state.
 */
export const SAMPLE_PLAYBACK_STATE: PlaybackState = {
  ...DEFAULT_PLAYBACK_STATE,
  mode: 'video',
  currentContent: SAMPLE_CONTENT,
  volume: 80,
};

/**
 * Sample node status.
 */
export const SAMPLE_NODE_STATUS: NodeStatus = {
  node: SAMPLE_NODE_INFO,
  connected: true,
  lastSeen: Date.now(),
  playbackState: SAMPLE_PLAYBACK_STATE,
  cachedContent: [
    {
      hash: SAMPLE_CONTENT.hash,
      filename: SAMPLE_CONTENT.filename,
      sizeBytes: SAMPLE_CONTENT.sizeBytes,
      type: 'video',
      cachedAt: SAMPLE_CONTENT.createdAt,
    },
  ],
  diskUsage: SAMPLE_DISK_USAGE,
  hardware: SAMPLE_HARDWARE_METRICS,
};

/**
 * Sample content sources for testing.
 */
export const SAMPLE_CONTENT_SOURCES: ContentSource[] = [
  { type: 'file', filename: 'test.mp4' },
  { type: 'url', url: TEST_DATA.videos[0] ?? '' },
  { type: 'youtube', url: TEST_DATA.youtube[0] ?? '' },
  { type: 'eden', collectionId: TEST_DATA.eden.prod[0] ?? '', db: 'PROD' },
  { type: 'eden', collectionId: TEST_DATA.eden.stage[0] ?? '', db: 'STAGE' },
];

/**
 * Generate a unique test ID.
 */
export function generateTestId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a mock node status with optional overrides.
 */
export function createMockNodeStatus(overrides?: Partial<NodeStatus>): NodeStatus {
  return {
    ...SAMPLE_NODE_STATUS,
    ...overrides,
    node: {
      ...SAMPLE_NODE_INFO,
      ...overrides?.node,
    },
    playbackState: {
      ...SAMPLE_PLAYBACK_STATE,
      ...overrides?.playbackState,
    },
  };
}

/**
 * Create a mock content item with optional overrides.
 */
export function createMockContent(overrides?: Partial<Content>): Content {
  return {
    ...SAMPLE_CONTENT,
    id: generateTestId('content'),
    ...overrides,
  };
}

/**
 * Create a mock playlist with optional overrides.
 */
export function createMockPlaylist(overrides?: Partial<Playlist>): Playlist {
  return {
    ...SAMPLE_PLAYLIST,
    id: generateTestId('playlist'),
    ...overrides,
  };
}
