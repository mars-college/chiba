/**
 * Playback state machine service.
 * Manages playback state transitions and broadcasts updates.
 */

import { createLogger, DEFAULT_PLAYBACK_STATE, DEFAULT_INTRO_DURATION, MIN_IMAGE_DURATION, MAX_IMAGE_DURATION, getContentType } from '@chiba/shared';
import type {
  PlaybackState,
  PlaybackMode,
  Content,
  Playlist,
  PlaylistItem,
  ContentSource,
  ContentMetadata,
  NodeToPlayerMessage,
  NodeToPlayerDownloadProgressMessage,
} from '@chiba/shared';
import { WebSocket } from 'ws';
import { getVolume, setVolume } from './volume.js';
import { markAsPlayed, getContentByFilename, downloadAndCache } from './content-cache.js';
import { isYouTubeUrl, downloadYouTube } from './youtube.js';
import { downloadCreation as downloadEdenCreation, syncCollection as syncEdenCollection } from './eden.js';
import { savePlaylist, markPlaylistPlayed } from '../db/index.js';

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
   * Send download progress to all players.
   */
  private sendDownloadProgress(progress: Omit<NodeToPlayerDownloadProgressMessage, 'type'>): void {
    const message: NodeToPlayerDownloadProgressMessage = {
      type: 'download_progress',
      ...progress,
    };
    for (const client of this.playerClients) {
      this.sendToPlayer(client, message);
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
    // loop option controls single-item looping, NOT playlist looping
    // Default to false for playlist items, true for single items played with loop intent
    const { loop: singleItemLoop = false, showIntro = false } = options;

    logger.info('Playing content', { filename: content.filename, type: content.type, singleItemLoop });
    markAsPlayed(content.hash);

    if (showIntro && content.metadata?.title) {
      // Show intro first - don't modify global loop state
      this.transition('intro', {
        currentContent: content,
        introMetadata: content.metadata,
        paused: false,
      });

      // Transition to actual content after intro
      const introDuration = content.metadata.introDuration ?? DEFAULT_INTRO_DURATION;
      this.introTimer = setTimeout(() => {
        this.startContentPlayback(content, singleItemLoop);
      }, introDuration);
    } else {
      this.startContentPlayback(content, singleItemLoop);
    }
  }

  /**
   * Start actual content playback (after intro if shown).
   * @param content The content to play
   * @param singleItemLoop Whether a single item (not in playlist) should loop indefinitely
   */
  private startContentPlayback(content: Content, singleItemLoop: boolean): void {
    // Detect actual content type from filename extension (don't trust content.type which may be stale)
    const actualType = getContentType(content.filename) ?? content.type;
    const mode: PlaybackMode = actualType === 'video' ? 'video' : 'image';

    // Don't modify the global loop state here - it controls playlist looping
    // Only update content and mode
    this.transition(mode, {
      currentContent: content,
      introMetadata: undefined,
      paused: false,
    });

    // For images: auto-advance after duration UNLESS it's a single item set to loop
    // In playlist mode, images always auto-advance (playlist loop is handled by next())
    const isInPlaylist = !!this.state.playlist;
    const shouldAutoAdvance = actualType === 'image' && (isInPlaylist || !singleItemLoop);

    if (shouldAutoAdvance) {
      this.imageTimer = setTimeout(() => {
        this.handleContentEnded();
      }, this.state.imageDuration);
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

    // Save playlist to database
    try {
      savePlaylist(playlist);
      markPlaylistPlayed(playlist.id);
    } catch (err) {
      logger.warn('Failed to save playlist to database', { error: (err as Error).message });
    }

    this.state.playlist = playlist;
    this.state.playlistIndex = startIndex;
    // Preserve user's loop/shuffle preferences (don't override from playlist)

    // Regenerate shuffle order for new playlist if shuffle is enabled
    if (this.state.shuffle && playlist.items.length > 1) {
      this.generateShuffledOrder();
    }

    this.playCurrentPlaylistItem().catch(err => {
      logger.error('Failed to play playlist item', err as Error);
    });
  }

  /**
   * Append items to the current playlist, or create a new one if none is active.
   */
  appendItems(
    items: PlaylistItem[],
    options: { name?: string; loop?: boolean; showIntros?: boolean } = {}
  ): Playlist {
    if (items.length === 0) {
      throw new Error('Cannot append empty items array');
    }

    if (this.state.playlist) {
      // Append to existing playlist
      const existingMaxOrder = Math.max(
        ...this.state.playlist.items.map(i => i.order),
        -1
      );
      const itemsWithOrder = items.map((item, idx) => ({
        ...item,
        order: existingMaxOrder + 1 + idx,
      }));

      this.state.playlist = {
        ...this.state.playlist,
        items: [...this.state.playlist.items, ...itemsWithOrder],
        updatedAt: Date.now(),
      };

      logger.info('Appended items to playlist', {
        playlistId: this.state.playlist.id,
        addedCount: items.length,
        totalItems: this.state.playlist.items.length,
      });

      // Save updated playlist to database
      try {
        savePlaylist(this.state.playlist);
      } catch (err) {
        logger.warn('Failed to save playlist to database', { error: (err as Error).message });
      }

      this.broadcast();
      return this.state.playlist;
    } else {
      // Create new playlist and start playing
      const { name = 'Dynamic Playlist', loop = true, showIntros = true } = options;

      const newPlaylist: Playlist = {
        id: crypto.randomUUID(),
        name,
        items: items.map((item, idx) => ({ ...item, order: idx })),
        loop,
        showIntros,
        introDuration: 3000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      logger.info('Created new playlist from append', {
        playlistId: newPlaylist.id,
        itemCount: items.length,
      });

      this.playPlaylist(newPlaylist, 0);
      return this.state.playlist!;
    }
  }

  /**
   * Play the current item in the playlist.
   * Resolves ContentSource items by downloading/caching them on-the-fly.
   */
  private async playCurrentPlaylistItem(): Promise<void> {
    const playlist = this.state.playlist;
    if (!playlist) return;

    // Get actual item index (respects shuffle if enabled)
    const actualIndex = this.getActualIndex(this.state.playlistIndex);
    const item = playlist.items[actualIndex];
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
      const itemName = item.metadata?.title || (source.type === 'file' ? source.filename : undefined);
      logger.info('Resolving playlist item content', { index: this.state.playlistIndex, sourceType: source.type });

      // Send download progress start (except for file lookups which are instant)
      if (source.type !== 'file') {
        this.sendDownloadProgress({
          progress: 0,
          status: 'downloading',
          name: itemName,
          message: 'Downloading...',
        });
      }

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

        // Send download complete
        if (source.type !== 'file') {
          this.sendDownloadProgress({
            progress: 100,
            status: 'completed',
            name: itemName,
          });
        }
      } catch (err) {
        logger.error('Failed to resolve playlist item', err as Error, { index: this.state.playlistIndex, source });
        // Send download error
        if (source.type !== 'file') {
          this.sendDownloadProgress({
            progress: 0,
            status: 'error',
            name: itemName,
            message: (err as Error).message,
          });
        }
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

    // Play content - loop:false means individual items don't loop indefinitely
    // The global loop state (for playlist looping) is preserved automatically
    this.playContent(contentWithMeta, { loop: false, showIntro: !!showIntro });
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
      // EMERGENCY HARDCODE: Always loop playlists. Remove `true ||` to restore normal behavior.
      if (true || this.state.loop) {
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
      // EMERGENCY HARDCODE: Always loop playlists. Remove `true ||` to restore normal behavior.
      if (true || this.state.loop) {
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
      // Restart single item - loop only applies to playlists
      this.playContent(this.state.currentContent);
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
   * Set image duration in milliseconds (clamped to 5s - 2min range).
   */
  setImageDuration(duration: number): void {
    const clampedDuration = Math.max(MIN_IMAGE_DURATION, Math.min(MAX_IMAGE_DURATION, Math.round(duration)));
    logger.info('Setting image duration', { duration: clampedDuration });
    this.state.imageDuration = clampedDuration;
    this.broadcast();
  }

  /**
   * Set shuffle state and generate shuffled order if enabling.
   */
  setShuffle(enabled: boolean): void {
    logger.info('Setting shuffle', { enabled });
    this.state.shuffle = enabled;

    if (enabled && this.state.playlist && this.state.playlist.items.length > 1) {
      // Generate shuffled order, keeping current item in place
      this.generateShuffledOrder();
    } else {
      this.state.shuffledOrder = undefined;
    }

    this.broadcast();
  }

  /**
   * Generate a new shuffled order for the playlist.
   * Ensures the current item stays at current position to avoid jarring skips.
   */
  private generateShuffledOrder(): void {
    const playlist = this.state.playlist;
    if (!playlist) return;

    const indices = Array.from({ length: playlist.items.length }, (_, i) => i);
    const currentIndex = this.state.playlistIndex;

    // Remove current index from shuffle pool
    const remaining = indices.filter(i => i !== currentIndex);

    // Fisher-Yates shuffle
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = remaining[i]!;
      remaining[i] = remaining[j]!;
      remaining[j] = temp;
    }

    // Insert current index at current position
    remaining.splice(currentIndex, 0, currentIndex);
    this.state.shuffledOrder = remaining;

    logger.debug('Generated shuffled order', { order: this.state.shuffledOrder });
  }

  /**
   * Get the actual playlist index for the current shuffle position.
   */
  private getActualIndex(position: number): number {
    if (this.state.shuffle && this.state.shuffledOrder) {
      return this.state.shuffledOrder[position] ?? position;
    }
    return position;
  }

  /**
   * Handle content ended event from player.
   * Loop setting ONLY applies to playlists, not single items.
   */
  handleContentEnded(): void {
    logger.debug('Content ended');

    if (this.state.playlist) {
      // Advance to next item in playlist
      // At end of playlist, next() checks loop to decide whether to restart
      this.next();
    } else {
      // Single item ended - always stop (loop only applies to playlists)
      this.stop();
    }
  }

  /**
   * Handle intro complete event from player.
   */
  handleIntroComplete(): void {
    logger.debug('Intro complete');

    if (this.state.currentContent) {
      // Loop setting only applies to playlists, individual items never loop
      this.startContentPlayback(this.state.currentContent, false);
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
export const setPlaybackShuffle = (enabled: boolean) => playbackManager.setShuffle(enabled);
export const handleContentEnded = () => playbackManager.handleContentEnded();
export const handleIntroComplete = () => playbackManager.handleIntroComplete();
export const addPlayerClient = (ws: WebSocket) => playbackManager.addPlayerClient(ws);
export const removePlayerClient = (ws: WebSocket) => playbackManager.removePlayerClient(ws);
export const appendItems = (
  items: PlaylistItem[],
  options?: { name?: string; loop?: boolean; showIntros?: boolean }
) => playbackManager.appendItems(items, options);
