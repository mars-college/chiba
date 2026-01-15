/**
 * Playback types for Chiba digital signage system.
 * Defines playback state, modes, and control commands.
 */

import type { Content, ContentSource, Playlist, PlaylistItem, ContentMetadata } from './content.js';
import { DEFAULT_IMAGE_DURATION, DEFAULT_INTRO_DURATION } from '../constants.js';

/**
 * Playback modes supported by the player.
 * - 'transition': Black screen shown before/after intros (when introDuration >= 5s)
 */
export type PlaybackMode = 'off' | 'video' | 'image' | 'playlist' | 'url' | 'intro' | 'transition';

/**
 * Current state of playback on a node.
 */
export interface PlaybackState {
  /** Current playback mode */
  mode: PlaybackMode;
  /** Currently playing content (for video/image modes) */
  currentContent?: Content;
  /** Current URL (for url mode) */
  currentUrl?: string;
  /** Active playlist (for playlist mode) */
  playlist?: Playlist;
  /** Current position in playlist (0-indexed) */
  playlistIndex: number;
  /** Whether playlist should loop */
  loop: boolean;
  /** Whether playlist should shuffle */
  shuffle: boolean;
  /** Shuffled order of playlist indices (when shuffle is enabled) */
  shuffledOrder?: number[];
  /** Whether playback is paused */
  paused: boolean;
  /** Volume level (0-100) */
  volume: number;
  /** Image display duration in milliseconds */
  imageDuration: number;
  /** Whether to show intro screens before each content item */
  showIntros: boolean;
  /** Intro screen duration in milliseconds (2000-20000) */
  introDuration: number;
  /** Current playback position in seconds (for videos) */
  position?: number;
  /** Intro screen currently being shown */
  introMetadata?: ContentMetadata;
  /** Increments each time content starts playing (used by player to detect loops) */
  playbackGeneration: number;
}

/**
 * Default playback state for a node.
 */
export const DEFAULT_PLAYBACK_STATE: PlaybackState = {
  mode: 'off',
  playlistIndex: 0,
  loop: true,
  shuffle: false,
  paused: false,
  volume: 100,
  imageDuration: DEFAULT_IMAGE_DURATION,
  showIntros: true,
  introDuration: DEFAULT_INTRO_DURATION,
  playbackGeneration: 0,
};

/**
 * Actions that can be performed on playback.
 */
export type PlaybackAction =
  | 'play'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'next'
  | 'previous'
  | 'seek'
  | 'volume'
  | 'restart';

/**
 * Payload for play action.
 */
export interface PlayPayload {
  /** Single content source to play */
  content?: ContentSource;
  /** Playlist items to play */
  playlist?: PlaylistItem[];
  /** URL to display in iframe */
  url?: string;
  /** Whether to loop playback */
  loop?: boolean;
  /** Whether to show intro screens */
  showIntros?: boolean;
  /** Default intro duration in milliseconds */
  introDuration?: number;
}

/**
 * Payload for seek action.
 */
export interface SeekPayload {
  /** Position to seek to in seconds */
  position: number;
}

/**
 * Payload for volume action.
 */
export interface VolumePayload {
  /** Volume level (0-100) */
  volume: number;
}

/**
 * A command to control playback.
 */
export interface PlaybackCommand {
  /** Action to perform */
  action: PlaybackAction;
  /** Optional payload depending on action */
  payload?: PlayPayload | SeekPayload | VolumePayload;
}

/**
 * Request to start playback on a node.
 */
export interface PlayRequest {
  /** Single content source to play */
  content?: ContentSource;
  /** Playlist items to play */
  playlist?: PlaylistItem[];
  /** URL to display in iframe */
  url?: string;
  /** Whether to loop playback (default: true) */
  loop?: boolean;
  /** Whether to show intro screens (default: true for playlists) */
  showIntros?: boolean;
  /** Default intro duration in milliseconds (default: 3000) */
  introDuration?: number;
}

/**
 * Request to set volume on a node.
 */
export interface VolumeRequest {
  /** Volume level (0-100) */
  volume: number;
}

/**
 * Response from playback operations.
 */
export interface PlaybackResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** Current playback state after operation */
  state: PlaybackState;
  /** Error message if operation failed */
  error?: string;
}
