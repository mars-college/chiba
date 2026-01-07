/**
 * Playback state machine service.
 * Manages playback state transitions and broadcasts updates.
 */

import { createLogger, DEFAULT_PLAYBACK_STATE, DEFAULT_INTRO_DURATION } from '@chiba/shared';
import type {
  PlaybackState,
  PlaybackMode,
  Content,
  Playlist,
  ContentSource,
  ContentMetadata,
  NodeToPlayerMessage,
} from '@chiba/shared';
import { WebSocket } from 'ws';
import { getVolume, setVolume } from './volume.js';
import { markAsPlayed, getContentByFilename, downloadAndCache } from './content-cache.js';
import { isYouTubeUrl, downloadYouTube } from './youtube.js';
import { downloadCreation as downloadEdenCreation, syncCollection as syncEdenCollection } from './eden.js';

const logger = createLogger('node', 'playback');

/**
 * Playback state manager.
 */
class PlaybackManager {
  private state: PlaybackState;
  private playerClients: Set<WebSocket> = new Set();
  private introTimer: NodeJS.Timeout | null = null;
  private imageTimer: NodeJS.Timeout | null = null;
  private stateChangeCallback: ((state: PlaybackState) => void) | null = null;

  constructor() {
    this.state = { ...DEFAULT_PLAYBACK_STATE, volume: getVolume() };
  }

  /**
   * Set callback for state changes (to notify controller).
   */
  onStateChange(callback: (state: PlaybackState) => void): void {
    this.stateChangeCallback = callback;
  }

  /**
   * Get current playback state.
   */
  getState(): PlaybackState {
    return { ...this.state };
  }

  /**
   * Register a player WebSocket client.
   */
  addPlayerClient(ws: WebSocket): void {
    this.playerClients.add(ws);
    // Send current state to new client
    this.sendToPlayer(ws, { type: 'state', playback: this.state });
  }

  /**
   * Unregister a player WebSocket client.
   */
  removePlayerClient(ws: WebSocket): void {
    this.playerClients.delete(ws);
  }

  /**
   * Broadcast state to all player clients and notify controller.
   */
  private broadcast(): void {
    const message: NodeToPlayerMessage = { type: 'state', playback: this.state };
    const data = JSON.stringify(message);

    for (const client of this.playerClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }

    // Notify controller via callback
    if (this.stateChangeCallback) {
      this.stateChangeCallback(this.state);
    }

    logger.debug('State broadcast', { mode: this.state.mode, clients: this.playerClients.size });
  }

  /**
   * Send message to a specific player.
   */
  private sendToPlayer(ws: WebSocket, message: NodeToPlayerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Clear any pending timers.
   */
  private clearTimers(): void {
    if (this.introTimer) {
      clearTimeout(this.introTimer);
      this.introTimer = null;
    }
    if (this.imageTimer) {
      clearTimeout(this.imageTimer);
      this.imageTimer = null;
    }
  }

  /**
   * Transition to a new state.
   */
  private transition(newMode: PlaybackMode, updates: Partial<PlaybackState> = {}): void {
    const oldMode = this.state.mode;
    this.clearTimers();

    this.state = {
      ...this.state,
      mode: newMode,
      ...updates,
    };

    logger.transition(oldMode, newMode, { content: this.state.currentContent?.filename });
    this.broadcast();
  }

  /**
   * Play a single content item.
   */
  playContent(content: Content, options: { loop?: boolean; showIntro?: boolean } = {}): void {
    const { loop = true, showIntro = false } = options;

    logger.info('Playing content', { filename: content.filename, type: content.type, loop });
    markAsPlayed(content.hash);

    if (showIntro && content.metadata?.title) {
      // Show intro first
      this.transition('intro', {
        currentContent: content,
        introMetadata: content.metadata,
        loop,
        paused: false,
      });

      // Transition to actual content after intro
      const introDuration = content.metadata.introDuration ?? DEFAULT_INTRO_DURATION;
      this.introTimer = setTimeout(() => {
        this.startContentPlayback(content, loop);
      }, introDuration);
    } else {
      this.startContentPlayback(content, loop);
    }
  }

  /**
   * Start actual content playback (after intro if shown).
   */
  private startContentPlayback(content: Content, loop: boolean): void {
    const mode: PlaybackMode = content.type === 'video' ? 'video' : 'image';

    this.transition(mode, {
      currentContent: content,
      introMetadata: undefined,
      loop,
      paused: false,
    });

    // For images, auto-advance after duration
    if (content.type === 'image' && !loop) {
      const duration = content.metadata?.introDuration ?? this.state.imageDuration;
      this.imageTimer = setTimeout(() => {
        this.handleContentEnded();
      }, duration);
    }
  }

  /**
   * Play a playlist.
   */
  playPlaylist(playlist: Playlist, startIndex = 0): void {
    if (playlist.items.length === 0) {
      logger.warn('Cannot play empty playlist');
      return;
    }

    logger.info('Playing playlist', { name: playlist.name, items: playlist.items.length, startIndex });

    this.state.playlist = playlist;
    this.state.playlistIndex = startIndex;
    this.state.loop = playlist.loop;

    this.playCurrentPlaylistItem().catch(err => {
      logger.error('Failed to play playlist item', err as Error);
    });
  }

  /**
   * Play the current item in the playlist.
   * Resolves ContentSource items by downloading/caching them on-the-fly.
   */
  private async playCurrentPlaylistItem(): Promise<void> {
    const playlist = this.state.playlist;
    if (!playlist) return;

    const item = playlist.items[this.state.playlistIndex];
    if (!item) {
      logger.warn('Playlist item not found', { index: this.state.playlistIndex });
      this.stop();
      return;
    }

    // Resolve content if it's a source reference
    let content: Content | null = null;
    if ('hash' in item.content) {
      // Already resolved Content object
      content = item.content as Content;
    } else {
      // It's a ContentSource - need to download/resolve
      const source = item.content as ContentSource;
      logger.info('Resolving playlist item content', { index: this.state.playlistIndex, sourceType: source.type });

      try {
        if (source.type === 'file') {
          // Look up by filename in cache
          content = getContentByFilename(source.filename);
          if (!content) {
            logger.warn('File not found in cache', { filename: source.filename });
          }
        } else if (source.type === 'url') {
          // Download URL content
          if (isYouTubeUrl(source.url)) {
            const result = await downloadYouTube(source.url, { name: item.metadata?.title });
            content = result.content;
          } else {
            const result = await downloadAndCache(source.url, { name: item.metadata?.title });
            content = result.content;
          }
        } else if (source.type === 'youtube') {
          // Download YouTube content
          const result = await downloadYouTube(source.url, { name: item.metadata?.title });
          content = result.content;
        } else if (source.type === 'eden_creation') {
          // Download Eden creation
          const result = await downloadEdenCreation(source.creationId, { db: source.db, name: item.metadata?.title });
          content = result.content;
        } else if (source.type === 'eden_collection') {
          // Sync Eden collection and take first item
          const result = await syncEdenCollection(source.collectionId, { db: source.db });
          const firstItem = result.playlist?.items[0];
          if (firstItem && 'hash' in firstItem.content) {
            content = firstItem.content as Content;
          }
        }
      } catch (err) {
        logger.error('Failed to resolve playlist item', err as Error, { index: this.state.playlistIndex, source });
      }
    }

    if (!content) {
      logger.warn('Could not resolve playlist item content', { index: this.state.playlistIndex });
      // Skip to next item
      this.next();
      return;
    }

    // Merge item metadata with content metadata
    const metadata: ContentMetadata = {
      ...content.metadata,
      ...item.metadata,
    };
    const contentWithMeta = { ...content, metadata };

    const showIntro = playlist.showIntros && (metadata.title || metadata.author);

    // Preserve the playlist's loop setting - individual items don't loop,
    // but we need to keep the playlist loop setting for when the playlist ends
    const playlistLoop = this.state.loop;
    this.playContent(contentWithMeta, { loop: false, showIntro: !!showIntro });
    this.state.loop = playlistLoop;
  }

  /**
   * Display a URL in iframe mode.
   */
  playUrl(url: string): void {
    logger.info('Playing URL', { url });
    this.transition('url', {
      currentUrl: url,
      currentContent: undefined,
      playlist: undefined,
      paused: false,
    });
  }

  /**
   * Stop playback and return to off mode.
   */
  stop(): void {
    logger.info('Stopping playback');
    this.transition('off', {
      currentContent: undefined,
      currentUrl: undefined,
      introMetadata: undefined,
      playlist: undefined,
      playlistIndex: 0,
      paused: false,
    });
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (this.state.mode === 'off') return;

    logger.info('Pausing playback');
    this.state.paused = true;
    this.broadcast();
  }

  /**
   * Resume playback.
   */
  resume(): void {
    if (this.state.mode === 'off') return;

    logger.info('Resuming playback');
    this.state.paused = false;
    this.broadcast();
  }

  /**
   * Skip to next item in playlist.
   */
  next(): void {
    const playlist = this.state.playlist;
    if (!playlist) {
      logger.warn('No playlist active');
      return;
    }

    const nextIndex = this.state.playlistIndex + 1;

    if (nextIndex >= playlist.items.length) {
      if (this.state.loop) {
        this.state.playlistIndex = 0;
        logger.info('Playlist looping to start');
      } else {
        logger.info('Playlist ended');
        this.stop();
        return;
      }
    } else {
      this.state.playlistIndex = nextIndex;
    }

    logger.info('Next item', { index: this.state.playlistIndex });
    this.playCurrentPlaylistItem().catch(err => {
      logger.error('Failed to play next item', err as Error);
    });
  }

  /**
   * Go to previous item in playlist.
   */
  previous(): void {
    const playlist = this.state.playlist;
    if (!playlist) {
      logger.warn('No playlist active');
      return;
    }

    const prevIndex = this.state.playlistIndex - 1;

    if (prevIndex < 0) {
      if (this.state.loop) {
        this.state.playlistIndex = playlist.items.length - 1;
        logger.info('Playlist looping to end');
      } else {
        this.state.playlistIndex = 0;
      }
    } else {
      this.state.playlistIndex = prevIndex;
    }

    logger.info('Previous item', { index: this.state.playlistIndex });
    this.playCurrentPlaylistItem().catch(err => {
      logger.error('Failed to play previous item', err as Error);
    });
  }

  /**
   * Restart current content or playlist.
   */
  restart(): void {
    if (this.state.playlist) {
      this.state.playlistIndex = 0;
      this.playCurrentPlaylistItem().catch(err => {
        logger.error('Failed to restart playlist', err as Error);
      });
    } else if (this.state.currentContent) {
      this.playContent(this.state.currentContent, { loop: this.state.loop });
    }
  }

  /**
   * Set volume.
   * Always updates state and broadcasts to player (which controls video element volume).
   * Optionally also sets system volume via ALSA on Linux.
   */
  setVolume(level: number): boolean {
    // Clamp to 0-100
    const clampedLevel = Math.min(100, Math.max(0, Math.round(level)));

    // Always update state and broadcast to player
    this.state.volume = clampedLevel;
    this.broadcast();

    // Also try to set system volume (optional, only works on Linux with ALSA)
    // Don't fail if this doesn't work - the player will handle volume via video element
    setVolume(clampedLevel);

    logger.info('Volume set', { level: clampedLevel });
    return true;
  }

  /**
   * Set loop state.
   */
  setLoop(enabled: boolean): void {
    logger.info('Setting loop', { enabled });
    this.state.loop = enabled;
    this.broadcast();
  }

  /**
   * Set image duration in milliseconds.
   */
  setImageDuration(duration: number): void {
    const clampedDuration = Math.max(1000, Math.round(duration)); // Minimum 1 second
    logger.info('Setting image duration', { duration: clampedDuration });
    this.state.imageDuration = clampedDuration;
    this.broadcast();
  }

  /**
   * Handle content ended event from player.
   */
  handleContentEnded(): void {
    logger.debug('Content ended');

    if (this.state.playlist) {
      // Advance to next item
      this.next();
    } else if (this.state.loop && this.state.currentContent) {
      // Loop single content
      this.playContent(this.state.currentContent, { loop: true });
    } else {
      // Stop
      this.stop();
    }
  }

  /**
   * Handle intro complete event from player.
   */
  handleIntroComplete(): void {
    logger.debug('Intro complete');

    if (this.state.currentContent) {
      this.startContentPlayback(this.state.currentContent, this.state.loop);
    }
  }
}

// Singleton instance
export const playbackManager = new PlaybackManager();

// Export convenience functions
export const getPlaybackState = () => playbackManager.getState();
export const playContent = (content: Content, options?: { loop?: boolean; showIntro?: boolean }) =>
  playbackManager.playContent(content, options);
export const playPlaylist = (playlist: Playlist, startIndex?: number) =>
  playbackManager.playPlaylist(playlist, startIndex);
export const playUrl = (url: string) => playbackManager.playUrl(url);
export const stopPlayback = () => playbackManager.stop();
export const pausePlayback = () => playbackManager.pause();
export const resumePlayback = () => playbackManager.resume();
export const nextItem = () => playbackManager.next();
export const previousItem = () => playbackManager.previous();
export const restartPlayback = () => playbackManager.restart();
export const setPlaybackVolume = (level: number) => playbackManager.setVolume(level);
export const setImageDuration = (duration: number) => playbackManager.setImageDuration(duration);
export const handleContentEnded = () => playbackManager.handleContentEnded();
export const handleIntroComplete = () => playbackManager.handleIntroComplete();
export const addPlayerClient = (ws: WebSocket) => playbackManager.addPlayerClient(ws);
export const removePlayerClient = (ws: WebSocket) => playbackManager.removePlayerClient(ws);
