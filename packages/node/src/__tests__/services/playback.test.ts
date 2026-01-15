/**
 * Playback state machine tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';

// Mock dependencies
vi.mock('ws', () => ({
  WebSocket: {
    OPEN: 1,
  },
}));

vi.mock('../../services/volume.js', () => ({
  getVolume: vi.fn(() => 100),
  setVolume: vi.fn(() => true),
}));

vi.mock('../../services/content-cache.js', () => ({
  markAsPlayed: vi.fn(),
  getExistingContent: vi.fn(),
  getContentByFilename: vi.fn(),
  downloadAndCache: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  savePlaylist: vi.fn(),
  markPlaylistPlayed: vi.fn(),
}));

vi.mock('../../services/youtube.js', () => ({
  isYouTubeUrl: vi.fn(() => false),
  downloadYouTube: vi.fn(),
}));

vi.mock('../../services/eden.js', () => ({
  downloadCreation: vi.fn(),
  syncCollection: vi.fn(),
}));

import {
  playbackManager,
  getPlaybackState,
  playContent,
  playPlaylist,
  playUrl,
  stopPlayback,
  pausePlayback,
  resumePlayback,
  nextItem,
  previousItem,
  restartPlayback,
  setPlaybackVolume,
  handleContentEnded,
  addPlayerClient,
  removePlayerClient,
} from '../../services/playback.js';
import type { Content, Playlist } from '@chiba/shared';

describe('playback service', () => {
  // Mock WebSocket client
  const createMockClient = (): WebSocket => ({
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
  } as unknown as WebSocket);

  const sampleContent: Content = {
    id: 'test-123',
    hash: 'abc123def456',
    filename: 'test-video.mp4',
    originalUrl: 'https://example.com/video.mp4',
    source: { type: 'url', url: 'https://example.com/video.mp4' },
    type: 'video',
    sizeBytes: 1000000,
    createdAt: Date.now(),
    metadata: {
      title: 'Test Video',
      author: 'Test Author',
    },
  };

  const samplePlaylist: Playlist = {
    id: 'playlist-1',
    name: 'Test Playlist',
    items: [
      { id: 'item-1', content: { ...sampleContent, id: 'content-1' }, order: 0 },
      { id: 'item-2', content: { ...sampleContent, id: 'content-2', filename: 'video2.mp4' }, order: 1 },
      { id: 'item-3', content: { ...sampleContent, id: 'content-3', filename: 'video3.mp4' }, order: 2 },
    ],
    loop: false,
    showIntros: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stopPlayback();
    // Reset loop to default (true) to ensure clean state between tests
    playbackManager.setLoop(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getPlaybackState', () => {
    it('should return default state when nothing is playing', () => {
      const state = getPlaybackState();

      expect(state.mode).toBe('off');
      expect(state.currentContent).toBeUndefined();
      expect(state.paused).toBe(false);
      expect(state.loop).toBe(true);
    });

    it('should return a copy of state (not reference)', () => {
      const state1 = getPlaybackState();
      const state2 = getPlaybackState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('playContent', () => {
    it('should start playing video content', () => {
      playContent(sampleContent);

      const state = getPlaybackState();
      expect(state.mode).toBe('video');
      expect(state.currentContent?.filename).toBe('test-video.mp4');
      expect(state.paused).toBe(false);
    });

    it('should start playing image content', () => {
      const imageContent: Content = {
        ...sampleContent,
        filename: 'image.jpg',
        type: 'image',
      };

      playContent(imageContent);

      const state = getPlaybackState();
      expect(state.mode).toBe('image');
    });

    it('should preserve existing loop setting when playing content', () => {
      // Loop is now controlled separately via setLoop(), not passed to playContent
      playbackManager.setLoop(false);
      playContent(sampleContent);

      expect(getPlaybackState().loop).toBe(false);
    });

    it('should show intro when enabled and metadata exists', () => {
      playContent(sampleContent, { showIntro: true });

      const state = getPlaybackState();
      expect(state.mode).toBe('intro');
      expect(state.introMetadata?.title).toBe('Test Video');
    });

    it('should transition from intro to content after duration', () => {
      playContent(sampleContent, { showIntro: true });

      expect(getPlaybackState().mode).toBe('intro');

      // Default intro duration is 3000ms
      vi.advanceTimersByTime(3000);

      expect(getPlaybackState().mode).toBe('video');
    });
  });

  describe('playPlaylist', () => {
    it('should start playing first item', () => {
      playPlaylist(samplePlaylist);

      const state = getPlaybackState();
      expect(state.playlist).toBeDefined();
      expect(state.playlistIndex).toBe(0);
      expect(state.currentContent?.id).toBe('content-1');
    });

    it('should start at specified index', () => {
      playPlaylist(samplePlaylist, 1);

      const state = getPlaybackState();
      expect(state.playlistIndex).toBe(1);
      expect(state.currentContent?.id).toBe('content-2');
    });

    it('should not play empty playlist', () => {
      const emptyPlaylist: Playlist = { ...samplePlaylist, items: [] };

      playPlaylist(emptyPlaylist);

      expect(getPlaybackState().playlist).toBeUndefined();
    });

    it('should apply playlist loop setting to state', () => {
      // When a playlist is played, its loop setting should be applied
      playbackManager.setLoop(false);
      const loopPlaylist = { ...samplePlaylist, loop: true };

      playPlaylist(loopPlaylist);

      // Loop setting should come from the playlist
      expect(getPlaybackState().loop).toBe(true);
    });
  });

  describe('playUrl', () => {
    it('should start URL mode', () => {
      playUrl('https://example.com/page');

      const state = getPlaybackState();
      expect(state.mode).toBe('url');
      expect(state.currentUrl).toBe('https://example.com/page');
    });

    it('should clear previous content', () => {
      playContent(sampleContent);
      playUrl('https://example.com/page');

      expect(getPlaybackState().currentContent).toBeUndefined();
    });
  });

  describe('stopPlayback', () => {
    it('should return to off mode', () => {
      playContent(sampleContent);
      stopPlayback();

      const state = getPlaybackState();
      expect(state.mode).toBe('off');
      expect(state.currentContent).toBeUndefined();
    });

    it('should clear playlist', () => {
      playPlaylist(samplePlaylist);
      stopPlayback();

      expect(getPlaybackState().playlist).toBeUndefined();
    });
  });

  describe('pausePlayback', () => {
    it('should pause active playback', () => {
      playContent(sampleContent);
      pausePlayback();

      expect(getPlaybackState().paused).toBe(true);
    });

    it('should not pause when off', () => {
      pausePlayback();

      expect(getPlaybackState().paused).toBe(false);
    });
  });

  describe('resumePlayback', () => {
    it('should resume paused playback', () => {
      playContent(sampleContent);
      pausePlayback();
      resumePlayback();

      expect(getPlaybackState().paused).toBe(false);
    });
  });

  describe('nextItem', () => {
    it('should advance to next playlist item', () => {
      playPlaylist(samplePlaylist);
      nextItem();

      expect(getPlaybackState().playlistIndex).toBe(1);
    });

    it('should loop to start when at end and loop enabled', () => {
      const loopPlaylist = { ...samplePlaylist, loop: true };
      playPlaylist(loopPlaylist, 2); // Start at last item

      nextItem();

      expect(getPlaybackState().playlistIndex).toBe(0);
    });

    it('should stop when at end and loop disabled', () => {
      playbackManager.setLoop(false);
      playPlaylist(samplePlaylist, 2); // Start at last item

      nextItem();

      expect(getPlaybackState().mode).toBe('off');
    });

    it('should work with single content (wrapped as playlist)', () => {
      // Single content is now wrapped in a 1-item playlist
      playContent(sampleContent);
      const stateAfterPlay = getPlaybackState();
      expect(stateAfterPlay.playlist).toBeDefined();
      expect(stateAfterPlay.playlist?.items.length).toBe(1);

      // With loop=true (default), nextItem loops back to the same item
      nextItem();
      expect(getPlaybackState().mode).toBe('video');
    });
  });

  describe('previousItem', () => {
    it('should go to previous playlist item', () => {
      playPlaylist(samplePlaylist, 2);
      previousItem();

      expect(getPlaybackState().playlistIndex).toBe(1);
    });

    it('should loop to end when at start and loop enabled', () => {
      const loopPlaylist = { ...samplePlaylist, loop: true };
      playPlaylist(loopPlaylist, 0);

      previousItem();

      expect(getPlaybackState().playlistIndex).toBe(2);
    });

    it('should stay at start when loop disabled', () => {
      playbackManager.setLoop(false);
      playPlaylist(samplePlaylist, 0);

      previousItem();

      expect(getPlaybackState().playlistIndex).toBe(0);
    });
  });

  describe('restartPlayback', () => {
    it('should restart playlist from beginning', () => {
      playPlaylist(samplePlaylist, 2);
      restartPlayback();

      expect(getPlaybackState().playlistIndex).toBe(0);
    });

    it('should restart single content', () => {
      playContent(sampleContent);
      pausePlayback();
      restartPlayback();

      expect(getPlaybackState().paused).toBe(false);
    });
  });

  describe('setPlaybackVolume', () => {
    it('should update volume in state', () => {
      setPlaybackVolume(75);

      expect(getPlaybackState().volume).toBe(75);
    });
  });

  describe('handleContentEnded', () => {
    it('should advance playlist', () => {
      playPlaylist(samplePlaylist, 0);
      handleContentEnded();

      expect(getPlaybackState().playlistIndex).toBe(1);
    });

    it('should loop single content when loop enabled', () => {
      // Single content is now wrapped in a 1-item playlist
      // Loop controls whether that playlist restarts
      playbackManager.setLoop(true);
      playContent(sampleContent);
      handleContentEnded();

      // Should restart the single-item playlist
      expect(getPlaybackState().mode).toBe('video');
    });

    it('should stop when single content finishes and loop disabled', () => {
      playbackManager.setLoop(false);
      playContent(sampleContent);
      handleContentEnded();

      expect(getPlaybackState().mode).toBe('off');
    });
  });

  describe('player client management', () => {
    it('should broadcast state to connected clients', () => {
      const client = createMockClient();
      addPlayerClient(client);

      // Should receive initial state
      expect(client.send).toHaveBeenCalled();
    });

    it('should send updates when state changes', () => {
      const client = createMockClient();
      addPlayerClient(client);
      (client.send as ReturnType<typeof vi.fn>).mockClear();

      playContent(sampleContent);

      expect(client.send).toHaveBeenCalled();
      const message = JSON.parse((client.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(message.type).toBe('state');
    });

    it('should not send to removed clients', () => {
      const client = createMockClient();
      addPlayerClient(client);
      removePlayerClient(client);
      (client.send as ReturnType<typeof vi.fn>).mockClear();

      playContent(sampleContent);

      expect(client.send).not.toHaveBeenCalled();
    });
  });
});
