/**
 * YouTube download service tests.
 */

import { describe, it, expect } from 'vitest';

import { isYouTubeUrl } from '../../services/youtube.js';

describe('youtube service', () => {
  describe('isYouTubeUrl', () => {
    it('should recognize youtube.com URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('should recognize youtu.be URLs', () => {
      expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
      expect(isYouTubeUrl('http://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('should recognize youtube.com shorts URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/shorts/ABC123')).toBe(true);
    });

    it('should recognize youtube.com embed URLs', () => {
      expect(isYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
    });

    it('should reject non-YouTube URLs', () => {
      expect(isYouTubeUrl('https://vimeo.com/123456')).toBe(false);
      expect(isYouTubeUrl('https://example.com/video.mp4')).toBe(false);
      expect(isYouTubeUrl('not a url')).toBe(false);
      expect(isYouTubeUrl('')).toBe(false);
      expect(isYouTubeUrl('https://notyoutube.com/watch?v=test')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isYouTubeUrl('youtube.com/watch?v=test')).toBe(false); // missing protocol
      expect(isYouTubeUrl('ftp://youtube.com/watch?v=test')).toBe(false); // wrong protocol
    });
  });
});
