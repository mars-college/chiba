/**
 * Tests for shared types and utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  getContentType,
  VIDEO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  DEFAULT_PLAYBACK_STATE,
  parseMessage,
  serializeMessage,
} from '../types/index.js';
import {
  TEST_DATA,
  SAMPLE_NODE_CONFIG,
  SAMPLE_NODE_INFO,
  SAMPLE_CONTENT,
  SAMPLE_PLAYLIST,
  createMockNodeStatus,
  createMockContent,
  generateTestId,
} from '../test-fixtures.js';

describe('Content Types', () => {
  describe('getContentType', () => {
    it('should detect video files', () => {
      expect(getContentType('video.mp4')).toBe('video');
      expect(getContentType('video.webm')).toBe('video');
      expect(getContentType('video.mov')).toBe('video');
      expect(getContentType('video.mkv')).toBe('video');
      expect(getContentType('video.avi')).toBe('video');
      expect(getContentType('video.m4v')).toBe('video');
    });

    it('should detect image files', () => {
      expect(getContentType('image.jpg')).toBe('image');
      expect(getContentType('image.jpeg')).toBe('image');
      expect(getContentType('image.png')).toBe('image');
      expect(getContentType('image.gif')).toBe('image');
      expect(getContentType('image.webp')).toBe('image');
      expect(getContentType('image.svg')).toBe('image');
    });

    it('should handle case insensitivity', () => {
      expect(getContentType('VIDEO.MP4')).toBe('video');
      expect(getContentType('Image.PNG')).toBe('image');
    });

    it('should return null for unknown types', () => {
      expect(getContentType('file.txt')).toBeNull();
      expect(getContentType('file.pdf')).toBeNull();
      expect(getContentType('file')).toBeNull();
    });
  });

  describe('extension constants', () => {
    it('should have video extensions', () => {
      expect(VIDEO_EXTENSIONS).toContain('.mp4');
      expect(VIDEO_EXTENSIONS).toContain('.webm');
      expect(VIDEO_EXTENSIONS.length).toBeGreaterThan(0);
    });

    it('should have image extensions', () => {
      expect(IMAGE_EXTENSIONS).toContain('.jpg');
      expect(IMAGE_EXTENSIONS).toContain('.png');
      expect(IMAGE_EXTENSIONS.length).toBeGreaterThan(0);
    });
  });
});

describe('Playback Types', () => {
  describe('DEFAULT_PLAYBACK_STATE', () => {
    it('should have correct defaults', () => {
      expect(DEFAULT_PLAYBACK_STATE.mode).toBe('off');
      expect(DEFAULT_PLAYBACK_STATE.playlistIndex).toBe(0);
      expect(DEFAULT_PLAYBACK_STATE.loop).toBe(true);
      expect(DEFAULT_PLAYBACK_STATE.paused).toBe(false);
      expect(DEFAULT_PLAYBACK_STATE.volume).toBe(100);
    });
  });
});

describe('Message Utilities', () => {
  describe('parseMessage', () => {
    it('should parse valid JSON', () => {
      const result = parseMessage<{ type: string }>('{"type":"test"}');
      expect(result).toEqual({ type: 'test' });
    });

    it('should return null for invalid JSON', () => {
      expect(parseMessage('not json')).toBeNull();
      expect(parseMessage('')).toBeNull();
      expect(parseMessage('{incomplete')).toBeNull();
    });
  });

  describe('serializeMessage', () => {
    it('should serialize to JSON', () => {
      const result = serializeMessage({ type: 'test', data: 123 });
      expect(result).toBe('{"type":"test","data":123}');
    });
  });
});

describe('Test Fixtures', () => {
  describe('TEST_DATA', () => {
    it('should have Eden collection IDs', () => {
      expect(TEST_DATA.eden.prod.length).toBeGreaterThan(0);
      expect(TEST_DATA.eden.stage.length).toBeGreaterThan(0);
    });

    it('should have video URLs', () => {
      expect(TEST_DATA.videos.length).toBeGreaterThan(0);
      expect(TEST_DATA.videos[0]).toMatch(/^https?:\/\//);
    });

    it('should have image URLs', () => {
      expect(TEST_DATA.images.length).toBeGreaterThan(0);
      expect(TEST_DATA.images[0]).toMatch(/^https?:\/\//);
    });

    it('should have YouTube URLs', () => {
      expect(TEST_DATA.youtube.length).toBeGreaterThan(0);
      expect(TEST_DATA.youtube[0]).toMatch(/youtube\.com/);
    });
  });

  describe('sample data', () => {
    it('should have valid node config', () => {
      expect(SAMPLE_NODE_CONFIG.id).toBeTruthy();
      expect(SAMPLE_NODE_CONFIG.friendlyName).toBeTruthy();
    });

    it('should have valid node info', () => {
      expect(SAMPLE_NODE_INFO.id).toBeTruthy();
      expect(SAMPLE_NODE_INFO.hostname).toBeTruthy();
      expect(SAMPLE_NODE_INFO.port).toBeGreaterThan(0);
    });

    it('should have valid content', () => {
      expect(SAMPLE_CONTENT.id).toBeTruthy();
      expect(SAMPLE_CONTENT.hash).toBeTruthy();
      expect(SAMPLE_CONTENT.type).toMatch(/^(video|image)$/);
    });

    it('should have valid playlist', () => {
      expect(SAMPLE_PLAYLIST.id).toBeTruthy();
      expect(SAMPLE_PLAYLIST.items.length).toBeGreaterThan(0);
    });
  });

  describe('factory functions', () => {
    it('should generate unique test IDs', () => {
      const id1 = generateTestId();
      const id2 = generateTestId();
      expect(id1).not.toBe(id2);
    });

    it('should create mock node status with overrides', () => {
      const status = createMockNodeStatus({
        connected: false,
      });
      expect(status.connected).toBe(false);
      expect(status.node.id).toBeTruthy();
    });

    it('should create mock content with overrides', () => {
      const content = createMockContent({
        type: 'image',
      });
      expect(content.type).toBe('image');
      expect(content.id).toBeTruthy();
    });
  });
});
