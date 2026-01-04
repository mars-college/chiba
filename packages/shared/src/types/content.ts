/**
 * Content types for Chiba digital signage system.
 * Defines content sources, cached content, and playlists.
 */

/**
 * Types of content sources supported by the system.
 */
export type ContentSourceType = 'file' | 'url' | 'youtube' | 'eden';

/**
 * A local file already cached on the node.
 */
export interface FileSource {
  type: 'file';
  /** Filename in the media directory */
  filename: string;
}

/**
 * A direct URL to download and cache.
 */
export interface UrlSource {
  type: 'url';
  /** Full URL to the media file */
  url: string;
}

/**
 * A YouTube video to download via yt-dlp.
 */
export interface YouTubeSource {
  type: 'youtube';
  /** YouTube video URL */
  url: string;
}

/**
 * An Eden collection to sync.
 */
export interface EdenSource {
  type: 'eden';
  /** Eden collection ID */
  collectionId: string;
  /** Eden database: PROD or STAGE */
  db?: 'PROD' | 'STAGE';
}

/**
 * Union type for all content sources.
 */
export type ContentSource = FileSource | UrlSource | YouTubeSource | EdenSource;

/**
 * Content types supported by the player.
 */
export type ContentType = 'video' | 'image';

/**
 * Video file extensions recognized by the system.
 */
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'] as const;

/**
 * Image file extensions recognized by the system.
 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'] as const;

/**
 * Metadata associated with content (for intro screens).
 */
export interface ContentMetadata {
  /** Title to display on intro screen */
  title?: string;
  /** Author/creator to display on intro screen */
  author?: string;
  /** Duration of intro screen in milliseconds (default: 3000) */
  introDuration?: number;
  /** Whether to show intro screen (default: true for playlists) */
  showIntro?: boolean;
}

/**
 * A cached content item stored on a node.
 */
export interface Content {
  /** Unique ID for this content */
  id: string;
  /** MD5 hash of file content */
  hash: string;
  /** Filename in media directory (hash.extension) */
  filename: string;
  /** User-friendly display name */
  name?: string;
  /** Original source URL if downloaded */
  originalUrl?: string;
  /** Source that provided this content */
  source: ContentSource;
  /** Content type (video or image) */
  type: ContentType;
  /** File size in bytes */
  sizeBytes: number;
  /** Video duration in seconds (videos only) */
  duration?: number;
  /** Video/image width in pixels */
  width?: number;
  /** Video/image height in pixels */
  height?: number;
  /** Content metadata for intro screens */
  metadata?: ContentMetadata;
  /** Unix timestamp when cached */
  createdAt: number;
  /** Unix timestamp of last playback */
  lastPlayedAt?: number;
}

/**
 * An item in a playlist.
 */
export interface PlaylistItem {
  /** Unique ID for this playlist item */
  id: string;
  /** Content source (may be resolved Content or pending ContentSource) */
  content: Content | ContentSource;
  /** Override display duration for images (milliseconds) */
  duration?: number;
  /** Position in playlist (0-indexed) */
  order: number;
  /** Metadata for intro screen (overrides content metadata) */
  metadata?: ContentMetadata;
}

/**
 * A saved playlist of content items.
 */
export interface Playlist {
  /** Unique ID for this playlist */
  id: string;
  /** Human-readable playlist name */
  name: string;
  /** Ordered list of items */
  items: PlaylistItem[];
  /** Whether to loop when reaching the end */
  loop: boolean;
  /** Whether to show intro screens between items */
  showIntros: boolean;
  /** Default intro duration in milliseconds */
  introDuration: number;
  /** Unix timestamp when created */
  createdAt: number;
  /** Unix timestamp when last modified */
  updatedAt: number;
}

/**
 * Request to cache content on a node.
 */
export interface CacheRequest {
  /** Content source to download and cache */
  source: ContentSource;
  /** Optional metadata to store with content */
  metadata?: ContentMetadata;
}

/**
 * Response from cache operation.
 */
export interface CacheResponse {
  /** MD5 hash of cached content */
  hash: string;
  /** Filename in media directory */
  filename: string;
  /** Whether the file was already cached */
  alreadyCached: boolean;
  /** File size in bytes */
  sizeBytes: number;
  /** Content metadata if available */
  metadata?: ContentMetadata;
}

/**
 * Detect content type from filename extension.
 */
export function getContentType(filename: string): ContentType | null {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'video';
  }

  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'image';
  }

  return null;
}
