/**
 * Content cache service tests.
 */

import { describe, it, expect } from 'vitest';

// Import the actual functions we're testing
import {
  isVideoFile,
  isImageFile,
  detectContentType,
  getMediaDir,
} from '../../services/content-cache.js';

describe('content-cache service', () => {
  describe('isVideoFile', () => {
    it('should detect MP4 files', () => {
      // MP4 magic: 0x00000020 ftyp (or similar with offset 4 being 'ftyp')
      const mp4Buffer = Buffer.alloc(12);
      mp4Buffer.writeUInt32BE(0x00000020, 0);
      mp4Buffer.write('ftyp', 4);

      expect(isVideoFile(mp4Buffer)).toBe(true);
    });

    it('should detect WebM files', () => {
      // WebM magic: 0x1A45DFA3
      const webmBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);

      expect(isVideoFile(webmBuffer)).toBe(true);
    });

    it('should detect MKV files', () => {
      // MKV shares same magic as WebM: 0x1A45DFA3
      const mkvBuffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);

      expect(isVideoFile(mkvBuffer)).toBe(true);
    });

    it('should return false for non-video files', () => {
      const textBuffer = Buffer.from('Hello World');

      expect(isVideoFile(textBuffer)).toBe(false);
    });
  });

  describe('isImageFile', () => {
    it('should detect JPEG files', () => {
      // JPEG magic: FF D8 FF
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);

      expect(isImageFile(jpegBuffer)).toBe(true);
    });

    it('should detect PNG files', () => {
      // PNG magic: 89 50 4E 47 0D 0A 1A 0A
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      expect(isImageFile(pngBuffer)).toBe(true);
    });

    it('should detect GIF files', () => {
      // GIF magic: GIF89a or GIF87a
      const gifBuffer = Buffer.from('GIF89a');

      expect(isImageFile(gifBuffer)).toBe(true);
    });

    it('should detect WebP files', () => {
      // WebP magic: RIFF....WEBP
      const webpBuffer = Buffer.alloc(12);
      webpBuffer.write('RIFF', 0);
      webpBuffer.write('WEBP', 8);

      expect(isImageFile(webpBuffer)).toBe(true);
    });

    it('should return false for non-image files', () => {
      const textBuffer = Buffer.from('Hello World');

      expect(isImageFile(textBuffer)).toBe(false);
    });
  });

  describe('detectContentType', () => {
    it('should return video for video files', () => {
      const mp4Buffer = Buffer.alloc(12);
      mp4Buffer.writeUInt32BE(0x00000020, 0);
      mp4Buffer.write('ftyp', 4);

      expect(detectContentType(mp4Buffer)).toBe('video');
    });

    it('should return image for image files', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      expect(detectContentType(jpegBuffer)).toBe('image');
    });

    it('should return null for unknown files', () => {
      const unknownBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);

      expect(detectContentType(unknownBuffer)).toBe(null);
    });
  });

  describe('getMediaDir', () => {
    it('should return a string path', () => {
      const dir = getMediaDir();

      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });

    it('should return consistent path', () => {
      const dir1 = getMediaDir();
      const dir2 = getMediaDir();

      expect(dir1).toBe(dir2);
    });
  });

  // Note: listCachedContent and getCacheSize require database initialization
  // They are tested as part of integration tests
});
