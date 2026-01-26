/**
 * Playback state machine service.
 * Manages playback state transitions and broadcasts updates.
 */

import {
  createLogger,
  DEFAULT_PLAYBACK_STATE,
  DEFAULT_INTRO_DURATION,
  MIN_IMAGE_DURATION,
  MAX_IMAGE_DURATION,
  MIN_INTRO_DURATION,
  MAX_INTRO_DURATION,
  INTRO_PADDING_THRESHOLD,
  INTRO_PADDING_PERCENT,
  getContentType,
} from '@chiba/shared';
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
import { markAsPlayed, getContentByFilename, downloadAndCache, getExistingContent } from './content-cache.js';
import { isYouTubeUrl, downloadYouTube } from './youtube.js';
import { downloadCreation as downloadEdenCreation, syncCollection as syncEdenCollection } from './eden.js';
import { savePlaylist, markPlaylistPlayed, saveResumeState, clearResumeState, getResumeState, getPlaylist } from '../db/index.js';

const logger = createLogger('node', 'playback');

/**
 * Playback state manager.
 */
class PlaybackManager {
  private state: PlaybackState;
  private playerClients: Set<WebSocket> = new Set();
  private introTimer: NodeJS.Timeout | null = null;
  private imageTimer: NodeJS.Timeout | null = null;
  private transitionTimer: NodeJS.Timeout | null = null;
  private stateChangeCallback: ((state: PlaybackState) => void) | null = null;
  private consecutiveFailures: number = 0;

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
   * Restore playback from saved resume state (for power-cut recovery).
   * Returns true if playback was restored, false if no resume state or idle.
   */
  restoreFromResumeState(): boolean {
    try {
      const resumeState = getResumeState();
      if (!resumeState) {
        logger.debug('No resume state found');
        return false;
      }

      if (resumeState.playlistId) {
        const playlist = getPlaylist(resumeState.playlistId);
        if (playlist) {
          logger.info('Restoring playlist playback after restart', {
            playlistId: playlist.id,
            playlistName: playlist.name,
            itemCount: playlist.items.length,
          });
          // Start from beginning (as per user's requirement)
          this.playPlaylist(playlist, 0);
          return true;
        } else {
          logger.warn('Resume playlist not found in database', { playlistId: resumeState.playlistId });
          clearResumeState();
        }
      } else if (resumeState.contentHash) {
        // Single content playback - look up by hash
        const content = getExistingContent(resumeState.contentHash);
        if (content) {
          logger.info('Restoring single content playback after restart', {
            hash: content.hash,
            filename: content.filename,
            name: content.name,
          });
          this.playContent(content);
          return true;
        } else {
          logger.warn('Resume content not found in cache', { contentHash: resumeState.contentHash });
          clearResumeState();
        }
      } else if (resumeState.url) {
        logger.info('Restoring URL playback after restart', { url: resumeState.url });
        this.playUrl(resumeState.url);
        return true;
      }
    } catch (err) {
      logger.error('Failed to restore from resume state', err as Error);
    }

    return false;
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
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
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
   * Create a single-item playlist from content.
   * This allows all playback to go through the unified playlist path.
   * Uses a proper UUID so it gets saved to the database like regular playlists.
   */
  private createSingleItemPlaylist(content: Content, showIntro: boolean): Playlist {
    return {
      id: crypto.randomUUID(),
      name: content.name || content.filename,
      items: [{
        id: `item_${content.hash}`,
        content: content,
        order: 0,
        metadata: content.metadata,
      }],
      loop: this.state.loop,  // Use current loop setting
      showIntros: showIntro && !!content.metadata?.title,
      introDuration: content.metadata?.introDuration ?? DEFAULT_INTRO_DURATION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Play a single content item.
   * Wraps content in a single-item playlist for unified playback handling.
   */
  playContent(content: Content, options: { showIntro?: boolean } = {}): void {
    const { showIntro = false } = options;

    logger.info('Playing content', { filename: content.filename, type: content.type });
    markAsPlayed(content.hash);

    // Create single-item playlist - loop/shuffle/duration settings are preserved
    // The playlist will be saved to DB in startPlaylistPlayback() with resume state
    const playlist = this.createSingleItemPlaylist(content, showIntro);
    this.playPlaylist(playlist, 0);
  }

  /**
   * Start actual content playback (after intro if shown).
   * All content is now played via playlists, so images auto-advance to next item.
   * Exception: Single-item playlists with loop - content stays on screen indefinitely.
   */
  private startContentPlayback(content: Content): void {
    // Detect actual content type from filename extension (don't trust content.type which may be stale)
    const actualType = getContentType(content.filename) ?? content.type;
    const mode: PlaybackMode = actualType === 'video' ? 'video' : 'image';

    // Check if this is a single-item playlist with loop (content should stay indefinitely)
    const isSingleItemLoop = this.state.playlist?.items.length === 1 && this.state.loop;

    this.transition(mode, {
      currentContent: content,
      introMetadata: undefined,
      paused: false,
      playbackGeneration: this.state.playbackGeneration + 1,
    });

    if (actualType === 'image') {
      if (isSingleItemLoop) {
        // Single image with loop - stay on screen indefinitely, no timer
        logger.debug('Single image with loop - displaying indefinitely');
      } else {
        // Multi-item playlist or no loop - auto-advance after duration
        this.imageTimer = setTimeout(() => {
          this.handleContentEnded();
        }, this.state.imageDuration);
      }
    }
    // Videos: wait for 'ended' event from player
    // For single-item video with loop, handleContentEnded will restart without intro
  }

  /**
   * Preload all playlist items by resolving ContentSource items to Content.
   * Downloads all files in advance to ensure smooth transitions.
   */
  private async preloadPlaylistItems(playlist: Playlist): Promise<Playlist> {
    const totalItems = playlist.items.length;
    let processedCount = 0;

    logger.info('Preloading playlist items', { name: playlist.name, totalItems });

    // Send initial preload progress
    this.sendDownloadProgress({
      progress: 0,
      status: 'downloading',
      message: `Preloading playlist (0/${totalItems})...`,
    });

    const resolvedItems: PlaylistItem[] = [];

    for (const item of playlist.items) {
      let content: Content | null = null;

      if ('hash' in item.content) {
        // Already resolved Content object
        content = item.content as Content;
        processedCount++;
      } else {
        // It's a ContentSource - need to download/resolve
        const source = item.content as ContentSource;
        const itemName = item.metadata?.title || (source.type === 'file' ? source.filename : `Item ${processedCount + 1}`);

        logger.info('Preloading playlist item', {
          index: processedCount,
          sourceType: source.type,
          name: itemName
        });

        // Send item-specific progress
        this.sendDownloadProgress({
          progress: (processedCount / totalItems) * 100,
          status: 'downloading',
          name: itemName,
          message: `Preloading ${itemName} (${processedCount + 1}/${totalItems})...`,
        });

        try {
          if (source.type === 'file') {
            // Look up by filename in cache
            content = getContentByFilename(source.filename);
            if (!content) {
              logger.warn('File not found in cache during preload', { filename: source.filename });
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
          processedCount++;
        } catch (err) {
          logger.error('Failed to preload playlist item', err as Error, {
            index: processedCount,
            source
          });
          // Continue with other items - failed ones will be skipped during playback
          processedCount++;
        }
      }

      // Keep item with resolved content (or original if resolution failed)
      if (content) {
        resolvedItems.push({
          ...item,
          content: content,
        });
      } else {
        // Keep original item - it will be skipped during playback
        resolvedItems.push(item);
      }
    }

    // Send preload complete
    this.sendDownloadProgress({
      progress: 100,
      status: 'completed',
      message: `Preloaded ${resolvedItems.filter(i => 'hash' in i.content).length}/${totalItems} items`,
    });

    logger.info('Playlist preload complete', {
      name: playlist.name,
      resolved: resolvedItems.filter(i => 'hash' in i.content).length,
      total: totalItems
    });

    return {
      ...playlist,
      items: resolvedItems,
    };
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

    // Reset failure counter for new playlist
    this.consecutiveFailures = 0;

    // For single-item playlists (including direct content playback), skip preload
    // since we already have the content resolved
    const needsPreload = playlist.items.some(item => !('hash' in item.content));

    if (needsPreload) {
      // Preload all items first, then start playback
      this.preloadPlaylistItems(playlist).then(preloadedPlaylist => {
        this.startPlaylistPlayback(preloadedPlaylist, startIndex);
      }).catch(err => {
        logger.error('Failed to preload playlist', err as Error);
        // Fall back to playing without preload
        this.startPlaylistPlayback(playlist, startIndex);
      });
    } else {
      // All items already resolved, start immediately
      this.startPlaylistPlayback(playlist, startIndex);
    }
  }

  /**
   * Internal: Start playlist playback after preloading is complete.
   */
  private startPlaylistPlayback(playlist: Playlist, startIndex: number): void {
    // Save playlist to database for resume and dashboard display
    try {
      savePlaylist(playlist);
      markPlaylistPlayed(playlist.id);
      // Save resume state so we can resume after power cut
      saveResumeState({ playlistId: playlist.id });
    } catch (err) {
      logger.warn('Failed to save playlist to database', { error: (err as Error).message });
    }

    this.state.playlist = playlist;
    this.state.playlistIndex = startIndex;
    // Apply playlist's loop setting to state so next() honors it
    this.state.loop = playlist.loop;

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
      this.consecutiveFailures++;
      logger.warn('Could not resolve playlist item content', {
        index: this.state.playlistIndex,
        consecutiveFailures: this.consecutiveFailures,
        playlistLength: playlist.items.length,
      });

      // Stop if all items in playlist have failed consecutively
      if (this.consecutiveFailures >= playlist.items.length) {
        logger.error('All playlist items failed to resolve, stopping playback', new Error('All items failed'), {
          playlistName: playlist.name,
          itemCount: playlist.items.length,
        });
        this.consecutiveFailures = 0;
        this.stop();
        return;
      }

      // Skip to next item
      this.next();
      return;
    }

    // Reset failure counter on success
    this.consecutiveFailures = 0;

    // Merge item metadata with content metadata
    const metadata: ContentMetadata = {
      ...content.metadata,
      ...item.metadata,
    };
    const contentWithMeta = { ...content, metadata };

    // Use node-level showIntros setting instead of playlist setting
    const showIntro = this.state.showIntros && (metadata.title || metadata.author);

    // Play content directly (don't go through playContent which creates new playlists)
    markAsPlayed(contentWithMeta.hash);

    if (showIntro) {
      // Use node-level introDuration setting
      const introDuration = this.state.introDuration;

      // Calculate padding: at or above threshold, add 20% padding before and after
      const paddingDuration = introDuration >= INTRO_PADDING_THRESHOLD
        ? Math.round(introDuration * INTRO_PADDING_PERCENT)
        : 0;

      if (paddingDuration > 0) {
        // Start with black screen (transition mode)
        this.transition('transition', {
          currentContent: contentWithMeta,
          introMetadata: metadata,
          paused: false,
        });

        // After pre-padding, show intro
        this.transitionTimer = setTimeout(() => {
          this.transition('intro', {
            currentContent: contentWithMeta,
            introMetadata: metadata,
            paused: false,
          });

          // After intro, show post-padding black screen
          this.introTimer = setTimeout(() => {
            this.transition('transition', {
              currentContent: contentWithMeta,
              introMetadata: undefined,
              paused: false,
            });

            // After post-padding, start content
            this.transitionTimer = setTimeout(() => {
              this.startContentPlayback(contentWithMeta);
            }, paddingDuration);
          }, introDuration);
        }, paddingDuration);
      } else {
        // No padding needed - just show intro then content
        this.transition('intro', {
          currentContent: contentWithMeta,
          introMetadata: metadata,
          paused: false,
        });

        this.introTimer = setTimeout(() => {
          this.startContentPlayback(contentWithMeta);
        }, introDuration);
      }
    } else {
      this.startContentPlayback(contentWithMeta);
    }
  }

  /**
   * Display a URL in iframe mode.
   */
  playUrl(url: string): void {
    logger.info('Playing URL', { url });

    // Save resume state so we can resume after power cut
    try {
      saveResumeState({ url });
    } catch (err) {
      logger.warn('Failed to save resume state', { error: (err as Error).message });
    }

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

    // Clear resume state - explicit stop means don't resume on restart
    try {
      clearResumeState();
    } catch (err) {
      logger.warn('Failed to clear resume state', { error: (err as Error).message });
    }

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
   * Set whether to show intro screens before each content item.
   */
  setShowIntros(enabled: boolean): void {
    logger.info('Setting showIntros', { enabled });
    this.state.showIntros = enabled;
    this.broadcast();
  }

  /**
   * Set intro screen duration in milliseconds (clamped to 2s - 20s range).
   */
  setIntroDuration(duration: number): void {
    const clampedDuration = Math.max(MIN_INTRO_DURATION, Math.min(MAX_INTRO_DURATION, Math.round(duration)));
    logger.info('Setting intro duration', { duration: clampedDuration });
    this.state.introDuration = clampedDuration;
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
   * Forward download progress to all connected players.
   * Used to show download progress on the player screen during async downloads.
   */
  forwardDownloadProgress(progress: {
    progress: number;
    status: 'queued' | 'started' | 'downloading' | 'processing' | 'completed' | 'error';
    message?: string;
    name?: string;
  }): void {
    this.sendDownloadProgress({
      progress: progress.progress,
      status: progress.status,
      message: progress.message,
      name: progress.name,
    });
  }

  /**
   * Handle content ended event from player.
   * For single-item playlists with loop, don't go through intro again - just loop the content.
   */
  handleContentEnded(): void {
    logger.debug('Content ended');

    if (this.state.playlist) {
      // Check if this is a single-item playlist with loop enabled
      if (this.state.playlist.items.length === 1 && this.state.loop) {
        // Single-item playlist with loop - restart content directly without intro
        const content = this.state.currentContent;
        if (content) {
          logger.info('Looping single-item playlist without intro');
          // Restart content playback directly (skips intro on subsequent loops)
          this.startContentPlayback(content);
          return;
        }
      }

      // Multi-item playlist or no loop - advance to next item
      // At end of playlist, next() checks loop to decide whether to restart
      this.next();
    } else {
      // No playlist - stop playback
      this.stop();
    }
  }

  /**
   * Handle intro complete event from player.
   */
  handleIntroComplete(): void {
    logger.debug('Intro complete');

    if (this.state.currentContent) {
      this.startContentPlayback(this.state.currentContent);
    }
  }
}

// Singleton instance
export const playbackManager = new PlaybackManager();

// Export convenience functions
export const getPlaybackState = () => playbackManager.getState();
export const playContent = (content: Content, options?: { showIntro?: boolean }) =>
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
export const setShowIntros = (enabled: boolean) => playbackManager.setShowIntros(enabled);
export const setIntroDuration = (duration: number) => playbackManager.setIntroDuration(duration);
export const handleContentEnded = () => playbackManager.handleContentEnded();
export const handleIntroComplete = () => playbackManager.handleIntroComplete();
export const addPlayerClient = (ws: WebSocket) => playbackManager.addPlayerClient(ws);
export const removePlayerClient = (ws: WebSocket) => playbackManager.removePlayerClient(ws);
export const appendItems = (
  items: PlaylistItem[],
  options?: { name?: string; loop?: boolean; showIntros?: boolean }
) => playbackManager.appendItems(items, options);
export const restoreFromResumeState = () => playbackManager.restoreFromResumeState();
export const forwardDownloadProgress = (progress: {
  progress: number;
  status: 'queued' | 'started' | 'downloading' | 'processing' | 'completed' | 'error';
  message?: string;
  name?: string;
}) => playbackManager.forwardDownloadProgress(progress);
